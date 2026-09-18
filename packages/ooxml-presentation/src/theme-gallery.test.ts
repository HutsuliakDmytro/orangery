import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { resolveColor } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'
import { colorContextFor, readThemes } from './theme-context'
import { applyTheme, THEME_GALLERY, themePathsOf } from './theme-gallery'
import { setThemeColors, setThemeFonts } from './write-theme'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(what)
  return value
}

const orangery = required(THEME_GALLERY[0], 'the gallery is empty')

/** Applies a theme, saves and reopens. */
async function apply(name: string, theme = orangery) {
  const pkg = await load(name)
  const changed = applyTheme(pkg, readDeck(pkg), theme)

  const reopened = await readPptxPackage(await saveDeck(pkg))
  const deck = readDeck(reopened)

  return { changed, pkg: reopened, deck, themes: readThemes(reopened, deck) }
}

describe('the gallery', () => {
  it('has Orangery first and six more', () => {
    expect(THEME_GALLERY).toHaveLength(7)
    expect(THEME_GALLERY[0]?.name).toBe('Orangery')
  })

  it('gives every theme a colour for every slot', () => {
    const slots = Object.keys(orangery.colors)

    for (const theme of THEME_GALLERY) {
      expect(Object.keys(theme.colors).sort()).toEqual(slots.sort())
      expect(Object.values(theme.colors).every((hex) => /^#[0-9A-F]{6}$/iu.test(hex))).toBe(true)
    }
  })
})

describe('applying a theme', () => {
  it('changes what the scheme slots stand for', async () => {
    const { changed, themes } = await apply('shapes')
    const theme = [...themes.values()][0]

    expect(changed).toBe(true)
    expect(theme?.colors.get('accent1')?.source).toEqual({ kind: 'srgb', hex: '#FF7A00' })
  })

  it('names the theme it applied', async () => {
    const { themes } = await apply('shapes')
    expect([...themes.values()][0]?.name).toBe('Orangery')
  })

  it('sets the two fonts a theme names', async () => {
    const { themes } = await apply('shapes')
    expect([...themes.values()][0]?.fonts).toEqual({ major: 'Inter', minor: 'Inter' })
  })

  it('repaints a shape that points at a slot', async () => {
    const pkg = await load('placeholders')
    const before = readDeck(pkg)
    const beforeTheme = [...readThemes(pkg, before).values()][0]

    const { deck, themes } = await apply('placeholders')
    const after = [...themes.values()][0]

    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    // The slide part never said "orange"; the slot it points at now does.
    const context = colorContextFor(deck, themes, slide)
    expect(
      resolveColor({ source: { kind: 'scheme', name: 'accent1' }, transforms: [] }, context)?.hex,
    ).toBe('#FF7A00')
    expect(after?.colors.get('accent1')).not.toEqual(beforeTheme?.colors.get('accent1'))
  })

  it('leaves the slide parts alone', async () => {
    // Nothing on a slide is repainted; the indirection is the whole point.
    const original = await load('shapes')
    const { pkg } = await apply('shapes')

    expect(getPartText(pkg, 'ppt/slides/slide1.xml')).toBe(
      getPartText(original, 'ppt/slides/slide1.xml'),
    )
  })

  it('reaches every master, so one slot cannot mean two colours', async () => {
    const pkg = await load('shapes')
    const deck = readDeck(pkg)
    const paths = themePathsOf(deck)

    applyTheme(pkg, deck, orangery)

    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(getPartText(pkg, path) ?? '').toContain('FF7A00')
    }
  })
})

describe('the theme parts themselves', () => {
  it('leaves a slot that was not named alone', async () => {
    const pkg = await load('shapes')
    const path = themePathsOf(readDeck(pkg))[0]
    if (path === undefined) throw new Error('fixture has no theme')

    const before = readDeck(pkg)
    const accent2 = [...readThemes(pkg, before).values()][0]?.colors.get('accent2')

    setThemeColors(pkg, path, { accent1: '#FF7A00' })

    const after = readDeck(pkg)
    expect([...readThemes(pkg, after).values()][0]?.colors.get('accent2')).toEqual(accent2)
  })

  it('writes only the latin face, leaving the other scripts as they were', async () => {
    // A picker offering one font cannot mean anything by the east-asian one.
    const pkg = await load('shapes')
    const path = themePathsOf(readDeck(pkg))[0]
    if (path === undefined) throw new Error('fixture has no theme')

    const before = (getPartText(pkg, path) ?? '').match(/<a:ea[^>]*\/>/gu)?.length ?? 0
    setThemeFonts(pkg, path, { major: 'Inter', minor: 'Inter' })
    const after = (getPartText(pkg, path) ?? '').match(/<a:ea[^>]*\/>/gu)?.length ?? 0

    expect(after).toBe(before)
  })

  it('reports nothing done for a part that is not a theme', async () => {
    const pkg = await load('shapes')
    expect(setThemeColors(pkg, 'ppt/slides/slide1.xml', { accent1: '#FF7A00' })).toBe(false)
    expect(setThemeFonts(pkg, 'ppt/slides/slide1.xml', { major: 'Inter' })).toBe(false)
  })
})
