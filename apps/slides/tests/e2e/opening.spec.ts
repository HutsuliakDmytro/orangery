import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * Opening a deck does not change it.
 *
 * The promise the whole engine is built around — open, save, get the same file
 * back — has a step in it that only exists in a real browser. A slide's text is
 * laid out by the engine and measured afterwards, and a shape that asks to fit
 * its text is resized from that measurement. Get the units wrong and every deck
 * is edited by the act of looking at it: the unit tests cannot see it, because
 * jsdom lays nothing out and every measurement there is zero.
 *
 * That is not a hypothesis either. Moving the text into pixels moved the
 * measurement with it, the pixels went into the file's EMU, and a three-inch
 * text box became two hundred and eighty-eight EMU — a thirtieth of a
 * millimetre — before anybody had touched the deck.
 *
 * Both engines, because both do the measuring, and they need not agree.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

/** Decks with something on them worth measuring: text, a table, many slides. */
const DECKS = ['text-formatting', 'placeholders', 'table', 'many-slides', 'charts']

const LOADED = `window.loaded = (name) => {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name)
  return entries.find((entry) => entry.includes(name)) ?? name
}`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(LOADED)
  await page.goto('/')
  // Something has to be open before a deck can be loaded into the store.
  await page.getByRole('button', { name: 'New Presentation' }).click()
})

for (const name of DECKS) {
  test(`${name} opens without being edited`, async ({ page }) => {
    const bytes = [...new Uint8Array(await readFile(join(FIXTURES, `${name}.pptx`)))]

    const state = await page.evaluate(
      async (deck: { bytes: number[]; name: string }) => {
        const store = (await import(loaded('deck-store'))) as {
          useDeckStore: {
            getState: () => {
              load: (bytes: Uint8Array, path: string) => Promise<void>
              saved: boolean
              undoStack: unknown[]
            }
          }
        }

        await store.useDeckStore.getState().load(new Uint8Array(deck.bytes), `/decks/${deck.name}`)
        // Long enough for the layout effects that measure text to have run.
        await new Promise((resolve) => setTimeout(resolve, 600))

        const after = store.useDeckStore.getState()
        return { saved: after.saved, steps: after.undoStack.length }
      },
      { bytes, name },
    )

    expect(state.saved, 'the deck says it has unsaved changes').toBe(true)
    expect(state.steps, 'the deck has something to undo').toBe(0)
  })
}
