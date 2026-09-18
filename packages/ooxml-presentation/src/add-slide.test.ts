import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import {
  addSlide,
  duplicateSlide,
  duplicateSlides,
  moveSlide,
  moveSlides,
  removeSlide,
  removeSlides,
  setSlideLayout,
} from './add-slide'
import { readDeck, readSlidePart } from './deck'
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

/** Duplicates a slide, saves, reopens. */
async function duplicate(name: string, index = 0) {
  const pkg = await load(name)
  const copy = duplicateSlide(pkg, index)
  const reopened = await readPptxPackage(await saveDeck(pkg))

  return { copy, pkg: reopened, deck: readDeck(reopened) }
}

const titleOf = (slide: { shapes: { text?: unknown }[] } | undefined) => {
  const text = slide?.shapes[0]?.text
  return text == null ? '' : textOfBody(text as Parameters<typeof textOfBody>[0])
}

describe('duplicating a slide', () => {
  it('lands right after the one it copies', async () => {
    const { deck } = await duplicate('many-slides', 2)

    expect(deck.slides).toHaveLength(9)
    expect(deck.slides.map(titleOf).slice(2, 5)).toEqual(['Slide 3', 'Slide 3', 'Slide 4'])
  })

  it('is a part of its own, not a second entry for the same one', async () => {
    const { copy, deck } = await duplicate('many-slides', 2)

    expect(deck.slides[3]?.path).toBe(copy?.path)
    expect(deck.slides[2]?.path).not.toBe(deck.slides[3]?.path)
  })

  it('carries the shapes over', async () => {
    const { deck } = await duplicate('shapes')
    const [original, copy] = deck.slides

    expect(copy?.shapes).toHaveLength(original?.shapes.length ?? -1)
    expect(copy?.shapes.map((shape) => shape.name)).toEqual(
      original?.shapes.map((shape) => shape.name),
    )
    expect(copy?.shapes.map((shape) => shape.transform)).toEqual(
      original?.shapes.map((shape) => shape.transform),
    )
  })

  it('stays on the same layout', async () => {
    const { deck } = await duplicate('placeholders')
    expect(deck.slides[1]?.layout).toBe(deck.slides[0]?.layout)
  })

  it('shares the picture rather than copying the bytes', async () => {
    // A deck of copies would grow by a megabyte each time otherwise.
    const before = await load('picture')
    const images = (pkg: Awaited<ReturnType<typeof load>>) =>
      [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/media/'))

    const { pkg, deck } = await duplicate('picture')

    expect(images(pkg)).toEqual(images(before))
    expect(deck.slides[1]?.shapes.some((shape) => shape.picture !== null)).toBe(true)
  })

  it('declares the new part, without which PowerPoint offers to repair', async () => {
    const { copy, pkg } = await duplicate('many-slides')
    expect(getPartText(pkg, '[Content_Types].xml')).toContain(copy?.path ?? 'missing')
  })

  it('takes a slide id nothing else is using', async () => {
    const { pkg } = await duplicate('many-slides')
    const ids = [
      ...(getPartText(pkg, 'ppt/presentation.xml') ?? '').matchAll(/<p:sldId id="(\d+)"/gu),
    ].map((match) => match[1])

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves the slide it copied byte for byte', async () => {
    const before = await load('shapes')
    const { pkg } = await duplicate('shapes')

    expect(getPartText(pkg, 'ppt/slides/slide1.xml')).toBe(
      getPartText(before, 'ppt/slides/slide1.xml'),
    )
  })

  it('gives the copy its own notes page', async () => {
    // Sharing one would make notes typed on the copy rewrite the original's.
    const { deck } = await duplicate('notes')
    const [original, copy] = deck.slides

    expect(original?.notes).toMatch(/^ppt\/notesSlides\//u)
    expect(copy?.notes).toMatch(/^ppt\/notesSlides\//u)
    expect(copy?.notes).not.toBe(original?.notes)
  })

  it('carries the notes text onto the copy', async () => {
    const { pkg, deck } = await duplicate('notes')
    const notesOf = (path: string | null | undefined) => {
      const part = path == null ? null : readSlidePart(pkg, path)
      const body = part?.shapes.find((shape) => shape.placeholder?.type === 'body')
      return body?.text == null ? '' : textOfBody(body.text)
    }

    expect(notesOf(deck.slides[1]?.notes)).toBe(notesOf(deck.slides[0]?.notes))
    expect(notesOf(deck.slides[1]?.notes)).not.toBe('')
  })

  it('reports nothing done for a slide that is not there', async () => {
    const pkg = await load('empty')
    expect(duplicateSlide(pkg, 4)).toBeNull()
  })

  it('never lands on a part that already exists', async () => {
    const pkg = await load('many-slides')
    const first = duplicateSlide(pkg, 0)
    const second = duplicateSlide(pkg, 0)

    expect(first?.path).not.toBe(second?.path)
  })
})

describe('changing the layout of a slide', () => {
  /** Puts slide `index` on layout `layoutIndex`, saves, reopens. */
  async function relayout(name: string, layoutIndex: number, index = 0) {
    const pkg = await load(name)
    const deck = readDeck(pkg)
    const slide = deck.slides[index]
    const layout = [...deck.layouts.values()][layoutIndex]
    if (slide === undefined || layout === undefined) throw new Error('fixture changed')

    const changed = setSlideLayout(pkg, slide, layout)
    const reopened = await readPptxPackage(await saveDeck(pkg))

    return { changed, layout, deck: readDeck(reopened), pkg: reopened }
  }

  it('points the slide at the new layout', async () => {
    const { changed, deck, layout } = await relayout('placeholders', 2)

    expect(changed).toBe(true)
    expect(deck.slides[0]?.layout).toBe(layout.path)
  })

  it('keeps the text that was on the slide', async () => {
    const before = readDeck(await load('placeholders'))
    const { deck } = await relayout('placeholders', 2)

    expect(deck.slides[0]?.shapes).toHaveLength(before.slides[0]?.shapes.length ?? -1)
    expect(titleOf(deck.slides[0])).toBe(titleOf(before.slides[0]))
  })

  it('leaves the slide part itself alone', async () => {
    // Only the relationship changes; a placeholder resolves against whichever
    // layout the slide points at.
    const before = await load('placeholders')
    const { pkg } = await relayout('placeholders', 2)

    expect(getPartText(pkg, 'ppt/slides/slide1.xml')).toBe(
      getPartText(before, 'ppt/slides/slide1.xml'),
    )
  })

  it('reports nothing done when it is already on that layout', async () => {
    const pkg = await load('placeholders')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    const layout = slide === undefined ? undefined : deck.layouts.get(slide.layout ?? '')
    if (slide === undefined || layout === undefined) throw new Error('fixture changed')

    expect(setSlideLayout(pkg, slide, layout)).toBe(false)
  })
})

describe('duplicating several slides', () => {
  /** Duplicates slides, saves, reopens. */
  async function duplicateMany(indexes: readonly number[]) {
    const pkg = await load('many-slides')
    const copies = duplicateSlides(pkg, indexes)
    return { copies, deck: readDeck(await readPptxPackage(await saveDeck(pkg))) }
  }

  it('puts the copies after the last one picked, in order', async () => {
    const { deck } = await duplicateMany([1, 2])

    expect(deck.slides.map(titleOf).slice(0, 6)).toEqual([
      'Slide 1',
      'Slide 2',
      'Slide 3',
      'Slide 2',
      'Slide 3',
      'Slide 4',
    ])
  })

  it('takes them in order however they were picked', async () => {
    const { deck } = await duplicateMany([4, 0, 2])

    expect(deck.slides.map(titleOf).slice(5, 8)).toEqual(['Slide 1', 'Slide 3', 'Slide 5'])
  })

  it('gives each copy a part of its own', async () => {
    const { copies } = await duplicateMany([0, 1, 2])
    expect(new Set(copies?.paths).size).toBe(3)
  })

  it('reports nothing done for an empty selection', async () => {
    const pkg = await load('many-slides')
    expect(duplicateSlides(pkg, [])).toBeNull()
  })
})

describe('removing several slides', () => {
  it('takes them all out, whatever order they were picked in', async () => {
    const pkg = await load('many-slides')
    expect(removeSlides(pkg, [5, 1, 3])).toBe(true)

    const deck = readDeck(await readPptxPackage(await saveDeck(pkg)))
    expect(deck.slides.map(titleOf)).toEqual([
      'Slide 1',
      'Slide 3',
      'Slide 5',
      'Slide 7',
      'Slide 8',
    ])
  })

  it('refuses to empty the deck rather than doing part of it', async () => {
    const pkg = await load('many-slides')
    expect(removeSlides(pkg, [0, 1, 2, 3, 4, 5, 6, 7])).toBe(false)

    const deck = readDeck(await readPptxPackage(await saveDeck(pkg)))
    expect(deck.slides).toHaveLength(8)
  })

  it('reports nothing done for an empty selection', async () => {
    const pkg = await load('many-slides')
    expect(removeSlides(pkg, [])).toBe(false)
  })
})

describe('moving several slides', () => {
  /** Moves slides onto the one at `to`, saves, reopens. */
  async function moveMany(indexes: readonly number[], to: number) {
    const pkg = await load('many-slides')
    const landed = moveSlides(pkg, indexes, to)
    return { landed, deck: readDeck(await readPptxPackage(await saveDeck(pkg))) }
  }

  it('drops a block below the slide it came to from above', async () => {
    const { landed, deck } = await moveMany([0, 1], 4)

    expect(deck.slides.map(titleOf)).toEqual([
      'Slide 3',
      'Slide 4',
      'Slide 5',
      'Slide 1',
      'Slide 2',
      'Slide 6',
      'Slide 7',
      'Slide 8',
    ])
    expect(landed?.index).toBe(3)
  })

  it('drops a block above the slide it came to from below', async () => {
    const { landed, deck } = await moveMany([5, 6], 1)

    expect(deck.slides.map(titleOf).slice(0, 4)).toEqual([
      'Slide 1',
      'Slide 6',
      'Slide 7',
      'Slide 2',
    ])
    expect(landed?.index).toBe(1)
  })

  it('keeps the slides in the order they were in', async () => {
    const { deck } = await moveMany([6, 2, 4], 0)
    expect(deck.slides.map(titleOf).slice(0, 4)).toEqual([
      'Slide 3',
      'Slide 5',
      'Slide 7',
      'Slide 1',
    ])
  })

  it('agrees with moving one slide on its own', async () => {
    const one = await moveMany([0], 3)

    const pkg = await load('many-slides')
    moveSlide(pkg, 0, 3)
    const expected = readDeck(await readPptxPackage(await saveDeck(pkg)))

    expect(one.deck.slides.map(titleOf)).toEqual(expected.slides.map(titleOf))
  })

  it('reports nothing done when a block is dropped on itself', async () => {
    const pkg = await load('many-slides')
    expect(moveSlides(pkg, [2, 3], 3)).toBeNull()
    expect(moveSlides(pkg, [], 3)).toBeNull()
    expect(moveSlides(pkg, [0], 99)).toBeNull()
  })
})
