import { readdir, readFile } from 'node:fs/promises'
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

const directory =
  process.env['ORANGERY_CORPUS'] ?? join(process.cwd(), '../../tests/fixtures/office')

async function decksIn(where: string): Promise<string[]> {
  try {
    const entries = await readdir(where, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pptx'))
      .map((entry) => join(where, entry.name))
  } catch {
    // No corpus is not a failure. It is the ordinary state of a checkout.
    return []
  }
}

const decks = await decksIn(directory)

afterEach(() => {
  cleanup()
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
