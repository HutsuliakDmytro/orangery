import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { children, getPartText, tagName } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { moveShape, writeCrop, writeTransform } from './write-shape'
import type { Shape } from './shape-tree'

/**
 * The test ADR 0002 asks for: edit, save, reopen, read back.
 *
 * Checking the XML a writer produced only proves the writer agrees with itself.
 * What matters is that the change survives a round trip, and that nothing else
 * does not.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** Opens, edits the first slide, saves and opens again. */
async function edit(name: string, change: (shapes: Shape[]) => void) {
  const pkg = await load(name)
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  change(slide.shapes)
  writeSlidePart(pkg, slide)

  const reopened = await readPptxPackage(await saveDeck(pkg))
  const before = await load(name)

  return { before, after: reopened, deck: readDeck(reopened), edited: slide.path }
}

describe('moving a shape', () => {
  it('comes back where it was put', async () => {
    const { deck } = await edit('shapes', (shapes) => {
      const first = shapes[0]
      if (first) moveShape(first, { x: 914400, y: -457200 })
    })

    // The rectangle starts at 457200, 1371600.
    expect(deck.slides[0]?.shapes[0]?.transform).toMatchObject({ x: 1371600, y: 914400 })
  })

  it('leaves every other part of the package byte for byte', async () => {
    const { before, after, edited } = await edit('shapes', (shapes) => {
      const first = shapes[0]
      if (first) moveShape(first, { x: 100000, y: 0 })
    })

    for (const [path, part] of before.parts) {
      if (path === edited) continue
      expect(after.parts.get(path)?.bytes, path).toStrictEqual(part.bytes)
    }
  })

  it('leaves the other shapes on the slide untouched', async () => {
    const { deck } = await edit('shapes', (shapes) => {
      const first = shapes[0]
      if (first) moveShape(first, { x: 100000, y: 0 })
    })

    expect(deck.slides[0]?.shapes[1]?.transform).toMatchObject({ x: 2468880, y: 1371600 })
  })

  it('keeps everything else in the edited shape', async () => {
    // The whole point of patching rather than rebuilding: a shape carries more
    // than this model knows about, and an edit to its position must not cost it.
    const { deck } = await edit('shapes', (shapes) => {
      const first = shapes[0]
      if (first) moveShape(first, { x: 100000, y: 0 })
    })
    const moved = deck.slides[0]?.shapes[0]

    expect(moved?.properties?.geometry?.preset).toBe('rect')
    expect(moved?.properties?.fill).toMatchObject({ kind: 'solid' })
    expect(moved?.style?.fill?.index).toBe(3)
    expect(moved?.text?.paragraphs[0]?.runs[0]?.text).toBe('Rectangle')
  })

  it('changes one shape in the slide part and nothing else in it', async () => {
    const pkg = await load('shapes')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    const before = getPartText(pkg, slide?.path ?? '') ?? ''

    const first = slide?.shapes[0]
    if (slide && first) {
      moveShape(first, { x: 12700, y: 0 })
      writeSlidePart(pkg, slide)
    }

    const after = getPartText(pkg, slide?.path ?? '') ?? ''
    expect(after).not.toBe(before)
    // 457200 + 12700; the other three shapes keep their own coordinates.
    expect(after).toContain('x="469900"')
    expect(after).toContain('x="2468880"')
  })
})

describe('a shape with no transform of its own', () => {
  it('gains one, in the place the schema puts it', async () => {
    // A placeholder inherits its position; dragging it has to write one, and an
    // a:xfrm after the geometry makes PowerPoint offer to repair the file.
    const { deck } = await edit('placeholders', (shapes) => {
      const title = shapes.find((shape) => shape.placeholder?.type === 'title')
      if (title) {
        writeTransform(title, {
          x: 100,
          y: 200,
          width: 300,
          height: 400,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
          child: null,
        })
      }
    })

    const title = deck.slides[0]?.shapes.find((shape) => shape.placeholder?.type === 'title')
    expect(title?.transform).toMatchObject({ x: 100, y: 200, width: 300, height: 400 })

    // First child of the shape properties, which is where the schema puts it.
    const properties = children(title?.node ?? {}).find((child) => tagName(child) === 'p:spPr')
    expect(children(properties ?? {}).map((child) => tagName(child))[0]).toBe('a:xfrm')
  })
})

describe('rotation and flips', () => {
  const rotate = (shape: Shape, rotation: number, flipH = false) => {
    const base = shape.transform ?? {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      child: null,
    }

    return writeTransform(shape, {
      ...base,
      rotation,
      flipHorizontal: flipH,
      flipVertical: false,
    })
  }

  it('writes a rotation and reads it back', async () => {
    const { deck } = await edit('shapes', (shapes) => {
      const first = shapes[0]
      if (first) rotate(first, 2700000)
    })

    expect(deck.slides[0]?.shapes[0]?.transform?.rotation).toBe(2700000)
  })

  it('removes the attribute when it goes back to none', async () => {
    // Writing rot="0" everywhere makes every saved file differ from the one it
    // was opened as, for no change anybody made.
    const pkg = await load('shapes')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    const first = slide?.shapes[0]

    if (slide && first) {
      rotate(first, 1200000)
      rotate(first, 0)
      writeSlidePart(pkg, slide)
    }

    expect(getPartText(pkg, slide?.path ?? '')).not.toContain('rot=')
  })

  it('writes a flip as the flag PowerPoint uses, and removes it again', async () => {
    const pkg = await load('shapes')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    const first = slide?.shapes[0]

    if (slide && first) {
      rotate(first, 0, true)
      writeSlidePart(pkg, slide)
    }
    expect(getPartText(pkg, slide?.path ?? '')).toContain('flipH="1"')

    if (slide && first) {
      rotate(first, 0, false)
      writeSlidePart(pkg, slide)
    }
    expect(getPartText(pkg, slide?.path ?? '')).not.toContain('flipH=')
  })
})

describe('cropping a picture', () => {
  it('comes back as what was set', async () => {
    const { deck, after, edited } = await edit('picture', (shapes) => {
      const picture = shapes.find((shape) => shape.picture !== null)
      if (picture !== undefined) {
        writeCrop(picture, { left: 0.1, top: 0.2, right: 0.05, bottom: 0 })
      }
    })

    const picture = deck.slides[0]?.shapes.find((shape) => shape.picture !== null)
    expect(picture?.picture?.crop).toEqual({ left: 0.1, top: 0.2, right: 0.05, bottom: 0 })
    expect(getPartText(after, edited)).toContain('<a:srcRect')
  })

  it('writes only the sides that are cropped', async () => {
    const { after, edited } = await edit('picture', (shapes) => {
      const picture = shapes.find((shape) => shape.picture !== null)
      if (picture !== undefined) writeCrop(picture, { left: 0.25, top: 0, right: 0, bottom: 0 })
    })

    const text = getPartText(after, edited) ?? ''
    expect(text).toContain('l="25000"')
    // A side cropped to nothing says nothing, as PowerPoint writes it.
    expect(text).not.toContain('t="0"')
  })

  it('takes the element away when nothing is cropped', async () => {
    const { after, edited } = await edit('picture', (shapes) => {
      const picture = shapes.find((shape) => shape.picture !== null)
      if (picture !== undefined) {
        writeCrop(picture, { left: 0.3, top: 0, right: 0, bottom: 0 })
        writeCrop(picture, { left: 0, top: 0, right: 0, bottom: 0 })
      }
    })

    // Cropped and uncropped is the picture it was, not one stating four zeroes.
    expect(getPartText(after, edited)).not.toContain('a:srcRect')
  })
})
