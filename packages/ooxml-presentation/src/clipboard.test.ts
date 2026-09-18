import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { copyShapes, parseClipboard, pasteShapes } from './clipboard'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten } from './shape-tree'

/**
 * Shapes on the clipboard.
 *
 * The interesting cases are all about what a shape points at rather than what
 * it is: the XML travels intact, and everything that can go wrong is a
 * relationship that meant something in the deck it came from.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

const NO_OFFSET = { offset: { x: 0, y: 0 } }

/** Copies from one deck and pastes into another, through the text a clipboard carries. */
async function across(from: string, to: string, options = NO_OFFSET) {
  const source = await load(from)
  const sourceSlide = readDeck(source).slides[0]
  if (sourceSlide === undefined) throw new Error('fixture has no slides')

  const payload = copyShapes(source, sourceSlide.path, sourceSlide.shapes)
  const text = JSON.stringify(payload)

  const target = await load(to)
  const targetDeck = readDeck(target)
  const slide = targetDeck.slides[0]
  const parsed = parseClipboard(text)
  if (slide === undefined || parsed === null) throw new Error('nothing to paste')

  const before = slide.shapes.length
  const ids = pasteShapes(target, slide, parsed, options)
  writeSlidePart(target, slide)

  const reopened = await readPptxPackage(await saveDeck(target))
  return { ids, before, pkg: reopened, deck: readDeck(reopened), path: slide.path }
}

describe('copying and pasting', () => {
  it('carries every shape across', async () => {
    const { deck, before, ids } = await across('shapes', 'empty')
    const after = deck.slides[0]?.shapes ?? []

    expect(ids.length).toBeGreaterThan(0)
    expect(after).toHaveLength(before + ids.length)
  })

  it('gives each one an id that is free in the slide it arrives in', async () => {
    const { deck } = await across('shapes', 'shapes')
    const ids = flatten(deck.slides[0]?.shapes ?? []).map((shape) => shape.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps what the model never read', async () => {
    const source = await load('shapes')
    const slide = readDeck(source).slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    const payload = copyShapes(source, slide.path, slide.shapes)
    // The XML itself travels, so a shape's style, its effects and anything else
    // arrive with it rather than being rebuilt from what we understood.
    expect(payload.shapes[0]).toContain('<p:sp>')
    expect(payload.shapes[0]).toContain('prstGeom')
  })

  it('leaves the shapes where they were when pasted onto another slide', async () => {
    const source = await load('shapes')
    const slide = readDeck(source).slides[0]
    const first = slide?.shapes[0]
    if (slide === undefined || first === undefined) throw new Error('fixture has no shapes')

    const { deck, before } = await across('shapes', 'empty')
    const pasted = (deck.slides[0]?.shapes ?? [])[before]

    expect(pasted?.transform?.x).toBe(first.transform?.x)
  })

  it('moves them aside when pasted where they came from', async () => {
    const source = await load('shapes')
    const first = readDeck(source).slides[0]?.shapes[0]
    const { deck, before } = await across('shapes', 'shapes', { offset: { x: 228600, y: 228600 } })
    const pasted = (deck.slides[0]?.shapes ?? [])[before]

    expect(pasted?.transform?.x).toBe((first?.transform?.x ?? 0) + 228600)
  })
})

describe('a picture on the clipboard', () => {
  it('takes its bytes with it', async () => {
    const { pkg, deck, before } = await across('picture', 'empty')

    const media = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/media/'))
    expect(media.length).toBeGreaterThan(0)

    // And the shape points at the copy in this package, not at an id that
    // meant something in the deck it came from.
    const pasted = flatten((deck.slides[0]?.shapes ?? []).slice(before))
    const picture = pasted.find((shape) => shape.picture !== null)
    expect(picture?.picture?.relationshipId).not.toBeNull()
  })

  it('draws from a relationship the arriving slide actually has', async () => {
    const { pkg, path, deck, before } = await across('picture', 'empty')
    const rels = getPartText(pkg, path.replace(/([^/]+)$/u, '_rels/$1.rels')) ?? ''

    const pasted = flatten((deck.slides[0]?.shapes ?? []).slice(before))
    const id = pasted.find((shape) => shape.picture !== null)?.picture?.relationshipId
    expect(id).not.toBeUndefined()
    expect(rels).toContain(`Id="${String(id)}"`)
  })
})

describe('reading the clipboard', () => {
  it('refuses text that is not ours', () => {
    expect(parseClipboard('hello')).toBeNull()
    expect(parseClipboard('{"kind":"something-else"}')).toBeNull()
  })

  it('refuses a version it does not know', () => {
    expect(parseClipboard('{"kind":"orangery/slides-shapes","version":2,"shapes":[]}')).toBeNull()
  })

  it('accepts one with no media at all', () => {
    const text = '{"kind":"orangery/slides-shapes","version":1,"shapes":["<p:sp/>"]}'
    expect(parseClipboard(text)?.shapes).toEqual(['<p:sp/>'])
  })
})
