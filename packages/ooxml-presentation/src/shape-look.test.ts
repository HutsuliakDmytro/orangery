import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveColor } from '@orangery/ooxml-drawingml'
import { readDeck, layoutOf, masterOf } from './deck'
import { readPptxPackage } from './parts'
import { lookContext, shapeLook } from './shape-look'
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

  return { deck, slide, theme, base: colorContextFor(deck, themes, slide) }
}

describe('a shape that states its own fill', () => {
  it('keeps it, and the reference does not override it', async () => {
    const { slide, theme, base } = await load('shapes')
    const rectangle = slide.shapes[0]
    if (!rectangle) throw new Error('fixture changed')

    const look = shapeLook(rectangle, theme)
    const color = look.fill?.kind === 'solid' ? look.fill.color : null

    expect(rectangle.style?.fill?.index).toBe(3)
    expect(color ? resolveColor(color, lookContext(base, look))?.hex : null).toBe('#161616')
    expect(look.placeholderColor).toBeNull()
  })
})

describe('a shape that states none', () => {
  it('takes the fill its style reference points at', async () => {
    // Without this the shape draws blank, which is what most shapes from a
    // template would do.
    const { slide, theme } = await load('groups-and-connectors')
    const rounded = slide.shapes.find((shape) => shape.name === 'Rounded Rectangle 1')
    if (!rounded) throw new Error('fixture changed')

    expect(rounded.properties?.fill).toBeNull()

    const look = shapeLook(rounded, theme)
    expect(look.fill?.kind).toBe('gradient')
  })

  it('resolves phClr in that fill to the colour the reference supplied', async () => {
    const { slide, theme, base } = await load('groups-and-connectors')
    const rounded = slide.shapes.find((shape) => shape.name === 'Rounded Rectangle 1')
    if (!rounded) throw new Error('fixture changed')

    const look = shapeLook(rounded, theme)
    const stop = look.fill?.kind === 'gradient' ? look.fill.stops[0] : undefined
    const resolved = stop?.color == null ? null : resolveColor(stop.color, lookContext(base, look))

    // accent1 is #4F81BD; the theme's third fill tints and saturates it, so the
    // answer is a lighter blue rather than the accent itself.
    expect(look.placeholderColor?.source).toEqual({ kind: 'scheme', name: 'accent1' })
    expect(resolved?.hex).toMatch(/^#[0-9A-F]{6}$/u)
    expect(resolved?.hex).not.toBe('#4F81BD')
  })

  it('takes the line from the reference too', async () => {
    const { slide, theme } = await load('groups-and-connectors')
    const rounded = slide.shapes.find((shape) => shape.name === 'Rounded Rectangle 1')
    if (!rounded) throw new Error('fixture changed')

    expect(rounded.properties?.line).toBeNull()
    expect(shapeLook(rounded, theme).line).not.toBeNull()
  })
})

describe('the index into the theme', () => {
  it('is one-based, and zero means no fill rather than the first one', async () => {
    const { theme } = await load('shapes')
    if (!theme) throw new Error('fixture has no theme')

    const shape = (index: number) => ({
      kind: 'sp' as const,
      id: 1,
      name: '',
      description: '',
      transform: null,
      placeholder: null,
      properties: null,
      style: { line: null, fill: { index, color: null }, effect: null, font: null },
      text: null,
      picture: null,
      connection: null,
      shapes: [],
      node: {},
    })

    expect(shapeLook(shape(1), theme).fill).toBe(theme.format.fills[0])
    expect(shapeLook(shape(0), theme).fill).toBeNull()
  })
})
