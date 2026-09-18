import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { addSlide, moveSlide, removeSlide } from './add-slide'
import { readDeck } from './deck'
import { relsPartFor } from './insert-picture'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** Adds a slide on a named layout, saves, reopens. */
async function add(name: string, layoutIndex = 1, after = 0) {
  const pkg = await load(name)
  const deck = readDeck(pkg)
  const layout = [...deck.layouts.values()][layoutIndex]
  if (layout === undefined) throw new Error('fixture has no such layout')

  const added = addSlide(pkg, deck, layout, after)
  const reopened = await readPptxPackage(await saveDeck(pkg))

  return { added, pkg: reopened, deck: readDeck(reopened), layout }
}

describe('adding a slide', () => {
  it('shows up in the deck', async () => {
    const { deck } = await add('empty')
    expect(deck.slides).toHaveLength(2)
  })

  it('lands where it was asked to, not at the end', async () => {
    const { deck } = await add('many-slides', 1, 2)
    const titles = deck.slides.map((slide) =>
      slide.shapes[0]?.text == null ? '' : textOfBody(slide.shapes[0].text),
    )

    // After the third, so the fourth entry is the new empty one.
    expect(titles[2]).toBe('Slide 3')
    expect(titles[3]).toBe('')
    expect(titles[4]).toBe('Slide 4')
  })

  it('is built on the layout it was given', async () => {
    const { deck, layout } = await add('empty')
    expect(deck.slides[1]?.layout).toBe(layout.path)
  })

  it("starts with the layout's placeholders, empty", async () => {
    const { deck } = await add('empty')
    const shapes = deck.slides[1]?.shapes ?? []

    expect(shapes.length).toBeGreaterThan(0)
    expect(shapes.every((shape) => shape.placeholder !== null)).toBe(true)
    expect(shapes.every((shape) => (shape.text ? textOfBody(shape.text) : '') === '')).toBe(true)
  })

  it('leaves the date, footer and slide number to the layout', async () => {
    // A copy on the slide would be a second one that stops following them.
    const { deck } = await add('empty')
    const types = (deck.slides[1]?.shapes ?? []).map((shape) => shape.placeholder?.type)

    expect(types).not.toContain('dt')
    expect(types).not.toContain('ftr')
    expect(types).not.toContain('sldNum')
  })

  it('declares the new part, without which PowerPoint offers to repair', async () => {
    const { added, pkg } = await add('empty')
    expect(getPartText(pkg, '[Content_Types].xml')).toContain(added?.path ?? 'missing')
  })

  it('points at its layout from its own relationships', async () => {
    const { added, pkg, layout } = await add('empty')
    const relationships = parseRelationships(getPartText(pkg, relsPartFor(added?.path ?? '')) ?? '')

    expect([...relationships.values()][0]?.target).toBe(
      `../slideLayouts/${layout.path.split('/').pop() ?? ''}`,
    )
  })

  it('takes a slide id nothing else is using', async () => {
    const { pkg } = await add('many-slides')
    const ids = [
      ...(getPartText(pkg, 'ppt/presentation.xml') ?? '').matchAll(/<p:sldId id="(\d+)"/gu),
    ].map((match) => match[1])

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(9)
  })

  it('never lands on a part that already exists', async () => {
    const pkg = await load('many-slides')
    const deck = readDeck(pkg)
    const layout = [...deck.layouts.values()][1]
    if (layout === undefined) throw new Error('fixture changed')

    const first = addSlide(pkg, deck, layout, 0)
    const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const second = addSlide(pkg, reopened, layout, 0)

    expect(first?.path).not.toBe(second?.path)
  })
})

describe('moving a slide', () => {
  it('changes the order and nothing else', async () => {
    const pkg = await load('many-slides')
    expect(moveSlide(pkg, 0, 3)).toBe(true)

    const deck = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const titles = deck.slides.map((slide) =>
      slide.shapes[0]?.text == null ? '' : textOfBody(slide.shapes[0].text),
    )

    // The order comes from sldIdLst; the parts keep their own names.
    expect(titles).toEqual([
      'Slide 2',
      'Slide 3',
      'Slide 4',
      'Slide 1',
      'Slide 5',
      'Slide 6',
      'Slide 7',
      'Slide 8',
    ])
    expect(deck.slides[3]?.path).toBe('ppt/slides/slide1.xml')
  })

  it('reports nothing done when it is already there', async () => {
    const pkg = await load('many-slides')
    expect(moveSlide(pkg, 2, 2)).toBe(false)
    expect(moveSlide(pkg, 0, 99)).toBe(false)
  })
})

describe('removing a slide', () => {
  it('takes it out of the deck', async () => {
    const pkg = await load('many-slides')
    expect(removeSlide(pkg, 0)).toBe(true)

    const deck = readDeck(await readPptxPackage(await saveDeck(pkg)))
    expect(deck.slides).toHaveLength(7)
    expect(
      deck.slides[0]?.shapes[0]?.text == null ? '' : textOfBody(deck.slides[0].shapes[0].text),
    ).toBe('Slide 2')
  })

  it('refuses to empty the deck', async () => {
    // A presentation with no slides is one PowerPoint will not open.
    const pkg = await load('empty')
    expect(removeSlide(pkg, 0)).toBe(false)
  })

  it('leaves the part in the package', async () => {
    // Removing the bytes would take the media only it used with it, which is a
    // larger question than this operation.
    const pkg = await load('many-slides')
    removeSlide(pkg, 0)

    expect(pkg.parts.has('ppt/slides/slide1.xml')).toBe(true)
  })
})
