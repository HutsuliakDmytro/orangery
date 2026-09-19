import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { parseShapeTree } from './shape-tree'
import { findInDeck, replaceInDeck, replaceInSlide, replaceMatch } from './find-replace'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import type { Deck, Slide } from './deck'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** Replaces across the deck, saves, reopens, and hands back the text of slide one. */
async function replace(name: string, query: string, replacement: string) {
  const pkg = await load(name)
  const deck = readDeck(pkg)

  const count = replaceInDeck(deck, query, replacement)
  for (const slide of deck.slides) writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  return { count, deck: reopened }
}

/**
 * A slide holding one shape whose text is the given runs.
 *
 * Parsed from XML and read back through the real shape reader rather than
 * assembled by hand: a hand-built node can satisfy the types and still not be
 * what the parser produces, and then the test measures the fixture.
 */
function slideWithRuns(...runs: string[]): Slide {
  const xml =
    '<p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp>' +
    '<p:nvSpPr><p:cNvPr id="2" name="Box"/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>' +
    runs.map((text) => `<a:r><a:rPr b="1"/><a:t>${text}</a:t></a:r>`).join('') +
    '</a:p></p:txBody></p:sp></p:spTree>'

  const tree = parseXml(xml)[0]
  if (tree === undefined) throw new Error('not parseable')

  return {
    path: 'ppt/slides/slide1.xml',
    id: '256',
    root: { 'p:sld': [{ 'p:cSld': [tree] }] },
    tree,
    shapes: parseShapeTree(tree),
    layout: null,
    notes: null,
  }
}

/** The text of a slide's one shape, read back from its XML. */
function textOf(slide: Slide): string {
  const body = parseShapeTree(slide.tree)[0]?.text
  return body === undefined || body === null ? '' : textOfBody(body)
}

describe('finding', () => {
  it('finds text across every slide', async () => {
    const deck = readDeck(await load('many-slides'))
    const matches = findInDeck(deck, 'Slide')

    expect(matches).toHaveLength(8)
    expect(matches.map((match) => match.slide)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('ignores case unless asked not to', async () => {
    const deck = readDeck(await load('many-slides'))

    expect(findInDeck(deck, 'slide')).toHaveLength(8)
    expect(findInDeck(deck, 'slide', { caseSensitive: true })).toHaveLength(0)
  })

  it('matches whole words when asked', async () => {
    const deck = readDeck(await load('text-formatting'))

    expect(findInDeck(deck, 'italic')).toHaveLength(1)
    // "italic" is a word here, "talic" is not.
    expect(findInDeck(deck, 'talic', { wholeWord: true })).toHaveLength(0)
  })

  it('looks inside table cells too', async () => {
    const deck = readDeck(await load('table'))
    expect(findInDeck(deck, 'Head')).toHaveLength(3)
  })

  it('finds a word split across runs, which a person sees as one word', () => {
    // Bolding the middle of a word writes it as three runs; a search that
    // looked at one run at a time would not find it.
    const slide = slideWithRuns('Pre', 'senta', 'tion')
    const deck = { slides: [slide] } as unknown as Parameters<typeof findInDeck>[0]

    expect(findInDeck(deck, 'Presentation')).toHaveLength(1)
  })

  it('finds nothing for an empty query rather than everything', async () => {
    const deck = readDeck(await load('many-slides'))
    expect(findInDeck(deck, '')).toHaveLength(0)
  })
})

describe('replacing', () => {
  it('changes the text in the file', async () => {
    const { count, deck } = await replace('many-slides', 'Slide', 'Page')

    expect(count).toBe(8)
    expect(deck.slides[0]?.shapes[0]?.text?.paragraphs[0]?.runs[0]?.text).toBe('Page 1')
  })

  it('replaces inside table cells', async () => {
    const { count, deck } = await replace('table', 'Head', 'Column')
    const frame = deck.slides[0]?.shapes.find((shape) => shape.kind === 'graphicFrame')

    expect(count).toBe(3)
    expect(frame?.graphic?.table?.rows[0]?.cells[0]?.text?.paragraphs[0]?.runs[0]?.text).toBe(
      'Column 1',
    )
  })

  it('leaves everything it did not match alone', async () => {
    const { deck } = await replace('text-formatting', 'bold', 'heavy')
    const runs = deck.slides[0]?.shapes[0]?.text?.paragraphs[0]?.runs

    expect(runs?.map((run) => run.text)).toEqual([
      'Plain ',
      'heavy ',
      'italic ',
      'large ',
      'orange',
    ])
    // The run kept the formatting that made it its own run.
    expect(runs?.[1]?.properties?.bold).toBe(true)
  })

  it('reports nothing done for a word that is not there', async () => {
    const { count } = await replace('many-slides', 'nowhere', 'x')
    expect(count).toBe(0)
  })
})

describe('a match that spans runs', () => {
  it('replaces it as one word', () => {
    const slide = slideWithRuns('Pre', 'senta', 'tion')

    expect(replaceInSlide(slide, 'Presentation', 'Deck')).toBe(1)
    expect(textOf(slide)).toBe('Deck')
  })

  it('puts the whole replacement in the first run it touched', () => {
    // Spreading it across the old runs by length would style letters by where
    // the ones they replaced happened to sit.
    const slide = slideWithRuns('Pre', 'senta', 'tion')
    replaceInSlide(slide, 'Presentation', 'Deck')

    const runs = parseShapeTree(slide.tree)[0]?.text?.paragraphs[0]?.runs ?? []
    expect(runs.map((run) => run.text)).toEqual(['Deck', '', ''])
  })

  it('keeps the text around the match', () => {
    const slide = slideWithRuns('A ', 'presenta', 'tion today')

    expect(replaceInSlide(slide, 'presentation', 'deck')).toBe(1)
    expect(textOf(slide)).toBe('A deck today')
  })

  it('replaces several matches in one paragraph', () => {
    const slide = slideWithRuns('one and one and one')

    expect(replaceInSlide(slide, 'one', 'two')).toBe(3)
    expect(textOf(slide)).toBe('two and two and two')
  })

  it('handles a replacement longer than what it replaced', () => {
    // Working forwards would shift every later offset by the difference.
    const slide = slideWithRuns('a a a')

    expect(replaceInSlide(slide, 'a', 'aaa')).toBe(3)
    expect(textOf(slide)).toBe('aaa aaa aaa')
  })
})

/** The slide a one-slide deck holds, with the check the types cannot make. */
function firstSlide(deck: Deck): Slide {
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('no slides')
  return slide
}

describe('replacing one match', () => {
  /**
   * A deck of one slide whose one shape holds the given paragraph runs.
   *
   * Only the slide list is filled: that is all this walks, and a whole package
   * built to satisfy the type would be scenery.
   */
  const deckOf = (...runs: string[]) => ({ slides: [slideWithRuns(...runs)] }) as Deck

  it('changes the one named and leaves the others', () => {
    const deck = deckOf('one two one two one')
    expect(replaceMatch(deck, 'one', 'ONE', 1)).toBe(true)

    // The second, counting as the list counts.
    expect(textOf(firstSlide(deck))).toBe('one two ONE two one')
  })

  it('counts through paragraphs in the order the search lists them', async () => {
    const pkg = await load('many-slides')
    const deck = readDeck(pkg)

    const matches = findInDeck(deck, 'Slide')
    expect(matches.length).toBeGreaterThan(2)

    const third = matches[2]
    if (third === undefined) throw new Error('fixture is too short')
    expect(replaceMatch(deck, 'Slide', 'Sheet', 2)).toBe(true)

    // The one that changed is the one on the slide the list said it was on.
    const after = findInDeck(deck, 'Sheet')
    expect(after).toHaveLength(1)
    expect(after[0]?.slide).toBe(third.slide)
  })

  it('leaves a match that spans runs on one of them, as replace-all does', () => {
    const deck = deckOf('Pre', 'sen', 'tation and Presentation')
    replaceMatch(deck, 'Presentation', 'Deck', 0)

    expect(textOf(firstSlide(deck))).toBe('Deck and Presentation')
  })

  it('says no when there is no match at that place', () => {
    expect(replaceMatch(deckOf('one'), 'one', 'two', 4)).toBe(false)
    expect(replaceMatch(deckOf('one'), 'one', 'two', -1)).toBe(false)
    expect(replaceMatch(deckOf('one'), '', 'two', 0)).toBe(false)
  })
})
