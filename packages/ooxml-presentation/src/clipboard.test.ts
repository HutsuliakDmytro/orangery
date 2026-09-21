import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseXml } from '@orangery/ooxml-core'
import { clipboardText, copyShapes, parseClipboard, pasteShapes } from './clipboard'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten, parseShape } from './shape-tree'

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

describe('what a pasted shape looks like', () => {
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

  /** A shape whose fill and font are named rather than stated. */
  function themed() {
    const xml =
      `<p:sp ${NS}><p:nvSpPr><p:cNvPr id="9" name="Themed"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      '<p:spPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>' +
      '</a:solidFill></p:spPr>' +
      '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:latin typeface="+mn-lt"/></a:rPr>' +
      '<a:t>Words</a:t></a:r></a:p></p:txBody></p:sp>'

    const node = parseXml(xml)[0]
    if (node === undefined) throw new Error('bad fixture')
    return parseShape(node)
  }

  const THEME = {
    colors: { accent1: '#123456' },
    fonts: { major: 'Georgia', minor: 'Verdana' },
  }

  /** Pastes one shape into a deck and gives back the slide part as text. */
  async function pasteInto(formatting: 'source' | 'destination') {
    const pkg = await load('empty')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    const payload = parseClipboard(
      JSON.stringify({ ...copyShapes(pkg, slide.path, [themed()], THEME) }),
    )
    if (payload === null) throw new Error('unreadable payload')

    pasteShapes(pkg, slide, payload, { offset: { x: 0, y: 0 }, formatting })
    writeSlidePart(pkg, slide)
    return getPartText(pkg, slide.path) ?? ''
  }

  it('takes this deck’s palette by default', async () => {
    const written = await pasteInto('destination')

    // The reference stays symbolic, which is what makes a shape pasted into a
    // branded deck come out in that brand.
    expect(written).toContain('accent1')
    expect(written).not.toContain('123456')
    expect(written).toContain('+mn-lt')
  })

  it('settles the colours against where it came from when asked', async () => {
    const written = await pasteInto('source')

    expect(written).toContain('123456')
    expect(written).not.toContain('schemeClr')
  })

  it('keeps the transform on a colour it settles', async () => {
    // `accent1` darkened by a quarter becomes that hex darkened by a quarter:
    // the same colour by a different route, not a flat one.
    expect(await pasteInto('source')).toContain('lumMod')
  })

  it('names the font the source was written with', async () => {
    const written = await pasteInto('source')

    expect(written).toContain('Verdana')
    expect(written).not.toContain('+mn-lt')
  })

  it('pastes in this deck’s colours when the payload carries no palette', async () => {
    const pkg = await load('empty')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    // A payload from a build that did not carry one: a reason to fall back,
    // not a reason to refuse.
    const payload = parseClipboard(JSON.stringify(copyShapes(pkg, slide.path, [themed()])))
    if (payload === null) throw new Error('unreadable payload')

    pasteShapes(pkg, slide, payload, { offset: { x: 0, y: 0 }, formatting: 'source' })
    writeSlidePart(pkg, slide)

    expect(getPartText(pkg, slide.path) ?? '').toContain('accent1')
  })
})

describe('the words on the clipboard', () => {
  it('are read out a paragraph at a time', async () => {
    const pkg = await load('shapes')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    const payload = copyShapes(pkg, slide.path, slide.shapes)
    expect(clipboardText(payload)).toContain('Rectangle')
  })

  it('are empty for shapes that hold none', async () => {
    const pkg = await load('picture')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    const payload = copyShapes(pkg, slide.path, slide.shapes)
    expect(clipboardText(payload).join('')).toBe('')
  })
})
