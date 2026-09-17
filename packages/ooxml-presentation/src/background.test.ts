import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveColor } from '@orangery/ooxml-drawingml'
import { backgroundOf, readBackground } from './background'
import { layoutOf, masterOf, readDeck } from './deck'
import { readPptxPackage } from './parts'
import { colorContextFor, readThemes } from './theme-context'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function load(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const themes = readThemes(pkg, deck)
  const slide = deck.slides[0]
  if (!slide) throw new Error('fixture has no slides')

  const layout = layoutOf(deck, slide)
  const master = layout === null ? null : masterOf(deck, layout)
  const theme = master?.theme == null ? undefined : themes.get(master.theme)

  return { deck, slide, layout, master, theme, context: colorContextFor(deck, themes, slide) }
}

describe('where a background comes from', () => {
  it('is the master, when neither slide nor layout states one', async () => {
    // Most slides state nothing. A renderer reading only the slide paints
    // everything white.
    const { deck, slide, master, theme } = await load('empty')

    expect(readBackground(slide, theme)).toBeNull()
    expect(backgroundOf(deck, slide, theme).from).toBe(master?.path)
  })

  it('resolves through the theme, where the index starts at 1001', async () => {
    // A default deck's master says bgRef idx="1001" with bg1 as phClr — the
    // background list is addressed separately from the shape fills.
    const { deck, slide, theme, context } = await load('empty')
    const background = backgroundOf(deck, slide, theme)

    expect(background.fill?.kind).toBe('solid')
    expect(background.placeholderColor?.source).toEqual({ kind: 'scheme', name: 'bg1' })

    const colour = background.fill?.kind === 'solid' ? background.fill.color : null
    const resolved =
      colour === null
        ? null
        : resolveColor(colour, {
            ...context,
            placeholderColor: background.placeholderColor ?? undefined,
          })

    // bg1 maps to lt1, which is the window colour: white.
    expect(resolved?.hex).toBe('#FFFFFF')
  })

  it('says nothing when there is no theme to resolve the reference against', async () => {
    const { deck, slide } = await load('empty')
    expect(backgroundOf(deck, slide, undefined).fill).toBeNull()
  })
})
