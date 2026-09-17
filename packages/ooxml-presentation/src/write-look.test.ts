import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { children, tagName } from '@orangery/ooxml-core'
import type { Fill } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { writeFill, writeLine } from './write-look'
import type { Shape } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** Changes the first slide, saves, reopens, and hands back the shapes. */
async function change(name: string, apply: (shapes: Shape[]) => void): Promise<Shape[]> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  apply(slide.shapes)
  writeSlidePart(pkg, slide)

  return readDeck(await readPptxPackage(await saveDeck(pkg))).slides[0]?.shapes ?? []
}

const orange: Fill = {
  kind: 'solid',
  color: { source: { kind: 'srgb', hex: '#FF7A00' }, transforms: [] },
}

describe('writing a fill', () => {
  it('comes back as the colour it was given', async () => {
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) writeFill(first, orange)
    })

    const fill = shapes[0]?.properties?.fill
    expect(fill?.kind === 'solid' ? fill.color?.source : null).toEqual({
      kind: 'srgb',
      hex: '#FF7A00',
    })
  })

  it('replaces the old fill rather than leaving two', async () => {
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) writeFill(first, orange)
    })
    const properties = children(shapes[0]?.node ?? {}).find((child) => tagName(child) === 'p:spPr')
    const fills = children(properties ?? {}).filter((child) =>
      (tagName(child) ?? '').endsWith('Fill'),
    )

    expect(fills).toHaveLength(1)
  })

  it('writes noFill for transparent rather than removing the element', async () => {
    // Removing it would send the shape back to its style reference, which is a
    // different shape from the one that was asked for.
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) writeFill(first, { kind: 'none' })
    })

    expect(shapes[0]?.properties?.fill).toEqual({ kind: 'none' })
  })

  it('keeps a theme colour symbolic', async () => {
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) {
        writeFill(first, {
          kind: 'solid',
          color: { source: { kind: 'scheme', name: 'accent2' }, transforms: [] },
        })
      }
    })

    const fill = shapes[0]?.properties?.fill
    expect(fill?.kind === 'solid' ? fill.color?.source : null).toEqual({
      kind: 'scheme',
      name: 'accent2',
    })
  })

  it('writes the modifiers a theme colour carries', async () => {
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) {
        writeFill(first, {
          kind: 'solid',
          color: {
            source: { kind: 'scheme', name: 'accent1' },
            transforms: [{ kind: 'lumMod', value: 0.6 }],
          },
        })
      }
    })

    const fill = shapes[0]?.properties?.fill
    expect(fill?.kind === 'solid' ? fill.color?.transforms : null).toEqual([
      { kind: 'lumMod', value: 0.6 },
    ])
  })

  it('leaves everything else in the shape alone', async () => {
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) writeFill(first, orange)
    })

    expect(shapes[0]?.properties?.geometry?.preset).toBe('rect')
    expect(shapes[0]?.properties?.line?.width).toBe(25400)
    expect(shapes[0]?.text?.paragraphs[0]?.runs[0]?.text).toBe('Rectangle')
  })
})

describe('writing a line', () => {
  it('changes only what it was told to', async () => {
    // A properties panel that reset the colour when the width changed would be
    // a properties panel nobody could use.
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first) writeLine(first, { width: 76200 })
    })
    const line = shapes[0]?.properties?.line

    expect(line?.width).toBe(76200)
    expect(line?.fill).toMatchObject({ kind: 'solid' })
  })

  it('sets a dash and clears it again', async () => {
    const dashed = await change('shapes', (all) => {
      const first = all[0]
      if (first) writeLine(first, { dash: 'dash' })
    })
    expect(dashed[0]?.properties?.line?.dash).toBe('dash')

    const plain = await change('shapes', (all) => {
      const first = all[0]
      if (first) {
        writeLine(first, { dash: 'dash' })
        writeLine(first, { dash: null })
      }
    })
    expect(plain[0]?.properties?.line?.dash).toBeNull()
  })

  it('creates the line on a shape that had none', async () => {
    const shapes = await change('groups-and-connectors', (all) => {
      const rounded = all.find((shape) => shape.name === 'Rounded Rectangle 1')
      if (rounded) writeLine(rounded, { width: 38100, fill: orange })
    })
    const rounded = shapes.find((shape) => shape.name === 'Rounded Rectangle 1')

    expect(rounded?.properties?.line?.width).toBe(38100)
  })

  it('puts the line where the schema puts it', async () => {
    // After the fill, before the effects; out of order and PowerPoint offers to
    // repair the file.
    const shapes = await change('groups-and-connectors', (all) => {
      const rounded = all.find((shape) => shape.name === 'Rounded Rectangle 1')
      if (rounded) writeLine(rounded, { width: 38100 })
    })

    const properties = children(
      shapes.find((shape) => shape.name === 'Rounded Rectangle 1')?.node ?? {},
    ).find((child) => tagName(child) === 'p:spPr')
    const tags = children(properties ?? {}).map((child) => tagName(child))

    expect(tags.indexOf('a:ln')).toBeGreaterThan(tags.indexOf('a:prstGeom'))
  })
})
