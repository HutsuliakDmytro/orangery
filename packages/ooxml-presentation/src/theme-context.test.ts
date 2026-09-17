import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readColor, resolveColor } from '@orangery/ooxml-drawingml'
import { parseXml } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { colorContextFor, readColorMap, readThemes } from './theme-context'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function load(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  return { pkg, deck, themes: readThemes(pkg, deck) }
}

const colorOf = (xml: string) => {
  const parsed = parseXml(xml)[0]
  return parsed === undefined ? null : readColor(parsed)
}

describe('readThemes', () => {
  it('parses the theme each master points at', async () => {
    const { themes } = await load('empty')

    expect([...themes.keys()]).toEqual(['ppt/theme/theme1.xml'])
    expect(themes.get('ppt/theme/theme1.xml')?.colors.get('accent1')?.source).toEqual({
      kind: 'srgb',
      hex: '#4F81BD',
    })
  })
})

describe('readColorMap', () => {
  it('reads what a shape means by tx1 and bg1', async () => {
    const { deck } = await load('empty')
    const [master] = [...deck.masters.values()]
    const map = master ? readColorMap(master) : new Map()

    expect(map.get('tx1')).toBe('dk1')
    expect(map.get('bg1')).toBe('lt1')
  })
})

describe('colorContextFor', () => {
  it('resolves a scheme colour through the master of the slide', async () => {
    const { deck, themes } = await load('placeholders')
    const slide = deck.slides[0]
    const context = slide ? colorContextFor(deck, themes, slide) : null
    const accent = colorOf('<a:schemeClr val="accent1"/>')

    expect(context && accent ? resolveColor(accent, context)?.hex : null).toBe('#4F81BD')
  })

  it('resolves tx1, which only the map can answer', async () => {
    const { deck, themes } = await load('placeholders')
    const slide = deck.slides[0]
    const context = slide ? colorContextFor(deck, themes, slide) : null
    const text = colorOf('<a:schemeClr val="tx1"/>')

    // The theme has no slot called tx1 at all.
    expect(context?.scheme.has('tx1')).toBe(false)
    expect(context && text ? resolveColor(text, context)?.hex : null).toBe('#000000')
  })
})
