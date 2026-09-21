import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readDeck, readPptxPackage, readThemes } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'

/**
 * Every slide of every real deck somebody has put in the corpus, drawn.
 *
 * The synthetic fixtures ask whether an element parses. This asks the question
 * that cannot be asked of a file we wrote ourselves: whether a deck made by
 * PowerPoint, Keynote or Google Slides can be **drawn** — which is a different
 * question from whether it can be read, and the one that was not being asked.
 *
 * It exists because of a black window. Opening somebody else's presentation
 * unmounted the whole app: a render threw, nothing caught it, and React took
 * the tree down without a word. Reading the deck was fine — the store catches
 * what reading throws and says so in a banner — so the failure was in the
 * drawing, where this repository had no real file to draw.
 *
 * With no corpus the suite says so and passes, which is what lets it live here
 * before the files do — see `tests/fixtures/office/README.md`, and set
 * `ORANGERY_CORPUS` to a private directory to keep a customer's deck out of
 * the repository.
 */

/** Whether somebody named a corpus, as opposed to there merely not being one. */
const asked = process.env['ORANGERY_CORPUS']

const directory = asked ?? join(process.cwd(), '../../tests/fixtures/office')

/**
 * The decks at a path, which may be one deck.
 *
 * A directory is what a corpus is, and a single file is what somebody has in
 * their hand when something goes wrong with it. Taking both is a line of code;
 * telling somebody their path was the wrong shape costs them the run.
 */
async function decksIn(where: string): Promise<string[]> {
  const found = await stat(where).catch(() => null)
  if (found === null) return []

  if (found.isFile()) return where.toLowerCase().endsWith('.pptx') ? [where] : []

  const entries = await readdir(where, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pptx'))
    .map((entry) => join(where, entry.name))
}

const decks = await decksIn(directory)

afterEach(() => {
  cleanup()
})

/**
 * A corpus asked for by name and not found is a mistake, not an absence.
 *
 * Skipping quietly is right for a checkout that simply has no corpus. It is
 * wrong for somebody who has just typed a path: a silent skip looks exactly
 * like a deck that drew without complaint, which is the opposite of the answer
 * they were after.
 */
describe.skipIf(asked === undefined)('the corpus that was asked for', () => {
  it('is where it was said to be', () => {
    expect(
      decks.length > 0 ? [] : [`ORANGERY_CORPUS is ${String(asked)}, and there is no .pptx there.`],
    ).toEqual([])
  })
})

describe.skipIf(decks.length === 0)('a deck somebody else made', () => {
  it.each(decks)('opens: %s', async (path) => {
    const pkg = await readPptxPackage(new Uint8Array(await readFile(path)))
    const deck = readDeck(pkg)

    expect(deck.slides.length).toBeGreaterThan(0)
  })

  /**
   * Drawn slide by slide rather than all at once, so the failure names the
   * slide. "It went black" is not a bug report and neither is "the deck threw".
   */
  it.each(decks)('draws every slide of: %s', async (path) => {
    const pkg = await readPptxPackage(new Uint8Array(await readFile(path)))
    const deck = readDeck(pkg)
    const themes = readThemes(pkg, deck)

    const broken: string[] = []

    for (const [index, slide] of deck.slides.entries()) {
      try {
        render(<SlideView deck={deck} slide={slide} themes={themes} package={pkg} />)
      } catch (error) {
        broken.push(
          `slide ${String(index + 1)} (${slide.path}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      } finally {
        cleanup()
      }
    }

    expect(broken).toEqual([])
  })
})
