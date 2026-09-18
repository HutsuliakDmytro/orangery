import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { flatten, readDeck, readPptxPackage } from '@orangery/ooxml-presentation'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { deckFromOutline, readOutline, slidesFromOutline } from './outline-import'

/**
 * A document's headings as a deck.
 *
 * The fixture is Docs' own headings document, read from here without going
 * anywhere near the Docs app: an outline is three elements of the format, and
 * reaching into another app for it is the one thing the monorepo forbids.
 */

const DOCX = join(process.cwd(), '../docs/tests/fixtures/docx/synthetic/headings.docx')

const load = () => readFile(DOCX).then((bytes) => new Uint8Array(bytes))

/** A document with no headings in it at all. */
const plainDocument = async () =>
  new Uint8Array(
    await readFile(
      join(process.cwd(), '../docs/tests/fixtures/docx/synthetic/paragraph-formatting.docx'),
    ),
  )

describe('reading the outline', () => {
  it('reads the title as the first level', async () => {
    const outline = await readOutline(await load())

    // A document's title is the first thing a deck says.
    expect(outline[0]).toEqual({ level: 0, text: 'Title of the document' })
  })

  it('reads each heading at the depth it had', async () => {
    const outline = await readOutline(await load())

    expect(outline.find((one) => one.text === 'Heading level 1')?.level).toBe(0)
    expect(outline.find((one) => one.text === 'Heading level 3')?.level).toBe(2)
  })

  it('leaves the body text out, which is not an outline', async () => {
    const outline = await readOutline(await load())

    // A deck made of every sentence in a document is a deck nobody can present.
    expect(outline.some((one) => one.text.startsWith('The quick brown fox'))).toBe(false)
  })

  it('reads nothing from a document with no headings', async () => {
    expect(await readOutline(await plainDocument())).toEqual([])
  })
})

describe('the slides an outline makes', () => {
  it('starts a slide at every top-level heading', () => {
    const slides = slidesFromOutline([
      { level: 0, text: 'First' },
      { level: 1, text: 'A point' },
      { level: 0, text: 'Second' },
    ])

    expect(slides.map((one) => one.title)).toEqual(['First', 'Second'])
  })

  it('puts what is under a heading on its slide, at its depth', () => {
    const slides = slidesFromOutline([
      { level: 0, text: 'First' },
      { level: 1, text: 'A point' },
      { level: 2, text: 'Under it' },
    ])

    expect(slides[0]?.body).toEqual([
      { text: 'A point', level: 0 },
      { text: 'Under it', level: 1 },
    ])
  })

  it('drops what comes before any heading', () => {
    // There is no slide for it to be on, and inventing one would be inventing
    // a slide nobody wrote.
    expect(slidesFromOutline([{ level: 2, text: 'Orphan' }])).toEqual([])
  })
})

describe('the deck it builds', () => {
  it('is a real package with the headings on it', async () => {
    const built = await deckFromOutline(await load())
    if (built === null) throw new Error('nothing was built')

    const deck = readDeck(await readPptxPackage(built))
    const titles = deck.slides.map((slide) => {
      // The first slide's is a `ctrTitle`, because the first heading of a
      // document is what the deck is called.
      const title = flatten(slide.shapes).find((shape) =>
        ['title', 'ctrTitle'].includes(shape.placeholder?.type ?? ''),
      )
      return title?.text == null ? '' : textOfBody(title.text)
    })

    expect(titles[0]).toBe('Title of the document')
    expect(titles).toContain('Heading level 1')
  })

  it('answers nothing for a document with no outline', async () => {
    // Better said out loud than answered with an empty deck.
    expect(await deckFromOutline(await plainDocument())).toBeNull()
  })
})
