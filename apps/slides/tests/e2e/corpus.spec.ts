import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * Somebody else's deck, opened in a real engine, in the whole window.
 *
 * The last place a black window can be hiding. The unit corpus draws every
 * slide through `SlideView` in jsdom and says nothing is wrong, which leaves
 * two things it cannot see:
 *
 * The engine. Every measurement in jsdom is zero, so anything measured — and
 * a deck's text is measured, because autofit shrinks it to fit — takes a
 * branch there that it does not take on a screen. This app runs in WKWebView
 * on macOS and in WebView2 on Windows, so the spec runs in WebKit and in
 * Chromium.
 *
 * The rest of the window. `SlideView` is the canvas; the filmstrip, the
 * outline, the properties panel and the notes all draw from the same deck, and
 * a throw in any of them takes the window down just as completely.
 *
 * `pageerror` is what makes this worth running: it catches the exception React
 * could not, with the message and the stack, which is the thing that was
 * missing when this started.
 *
 *     ORANGERY_CORPUS=~/Downloads/deck.pptx pnpm --filter slides test:e2e
 *
 * Skips when no corpus is named, which is the ordinary state of a checkout.
 */

const asked = process.env['ORANGERY_CORPUS']

async function decksIn(where: string): Promise<string[]> {
  const found = await stat(where).catch(() => null)
  if (found === null) return []

  if (found.isFile()) return where.toLowerCase().endsWith('.pptx') ? [where] : []

  const entries = await readdir(where, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pptx'))
    .map((entry) => join(where, entry.name))
}

const decks = asked === undefined ? [] : await decksIn(asked)

const LOADED = `window.loaded = (name) => {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name)
  return entries.find((entry) => entry.includes(name)) ?? name
}`

/**
 * Always here, so the file is never a file with no tests in it.
 *
 * Silent when nobody named a corpus, which is the ordinary state of a
 * checkout, and loud when somebody named one that is not there — a path typed
 * on purpose that quietly matches nothing is the worst answer this can give.
 */
test('there is a deck to open', () => {
  test.skip(asked === undefined, 'No ORANGERY_CORPUS, so there is no deck to open.')

  expect(
    decks,
    `ORANGERY_CORPUS is ${String(asked)}, and there is no .pptx there.`,
  ).not.toHaveLength(0)
})

for (const path of decks) {
  test(`opens in a real engine without taking the window down: ${path}`, async ({ page }) => {
    /**
     * Everything the page threw, caught where React could not catch it.
     *
     * A render that throws unmounts the tree; an error in an effect or a
     * handler never reaches a boundary at all. Both arrive here.
     */
    const thrown: string[] = []
    page.on('pageerror', (error) => {
      thrown.push(`${error.message}\n${error.stack ?? ''}`)
    })

    await page.addInitScript(LOADED)
    await page.goto('/')
    await page.getByRole('button', { name: 'New Presentation' }).click()

    const bytes = [...new Uint8Array(await readFile(path))]

    await page.evaluate(async (deck: number[]) => {
      const store = (await import(loaded('deck-store'))) as {
        useDeckStore: {
          getState: () => { load: (bytes: Uint8Array, path: string) => Promise<void> }
        }
      }

      await store.useDeckStore.getState().load(new Uint8Array(deck), '/decks/corpus.pptx')
      // Long enough for the layout effects that measure text to have run, and
      // for anything they throw to have been thrown.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }, bytes)

    /**
     * What the boundary caught, which is the answer when there is one.
     *
     * A render that throws is caught rather than thrown at the window now, so
     * it never reaches `pageerror`: it reaches the boundary, which draws the
     * message and the component stack. Read here and put in the failure, so
     * that one run gives the whole answer rather than the news that there is
     * one.
     */
    // Counted rather than waited for: there is usually no alert, and waiting
    // for one that is not coming spends the timeout on every healthy deck.
    const alerts = page.getByRole('alert')
    const caught = (await alerts.count()) > 0 ? await alerts.first().textContent() : null

    expect(
      caught === null ? [] : [caught.replace(/\s+/gu, ' ').trim()],
      'the window caught an error while drawing this deck',
    ).toEqual([])

    // Nothing thrown outside a render either — an effect, a handler, a
    // listener. Those never reach a boundary and would take the window down
    // without a word.
    expect(thrown, 'the page threw while opening the deck').toEqual([])

    // And the window is still a window. `main` is the part that is there
    // whatever is on the slide, so it going missing means the tree came down —
    // which is what a black window is.
    await expect(page.getByRole('main')).toBeVisible()
  })
}
