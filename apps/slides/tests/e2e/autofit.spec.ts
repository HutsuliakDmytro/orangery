import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * A shape that grows to its words, measured by a real engine.
 *
 * `a:spAutoFit` says the shape gives instead of the text, and deciding by how
 * much means laying the text out and measuring it — which jsdom does not do.
 * The unit tests stand the measurement in, so what they check is the
 * arithmetic; this checks that the arithmetic is fed real numbers.
 *
 * The asymmetry is the point. It grows when words stop fitting, which only ever
 * follows somebody's typing, and it does not shrink a roomy box — that would
 * fire on opening a deck nobody had touched and rewrite its geometry.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const LOADED = `window.loaded = (name) => {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name)
  return entries.find((entry) => entry.includes(name)) ?? name
}`

/** The height of the slide's first shape, as the deck states it. */
async function firstHeight(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const store = (await import(loaded('deck-store'))) as {
      useDeckStore: {
        getState: () => {
          open: { deck: { slides: { shapes: { transform: { height: number } }[] }[] } } | null
        }
      }
    }

    const open = store.useDeckStore.getState().open
    return open?.deck.slides[0]?.shapes[0]?.transform.height ?? 0
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(LOADED)
  await page.goto('/')
  await page.getByRole('button', { name: 'New Presentation' }).click()

  const bytes = [...new Uint8Array(await readFile(join(FIXTURES, 'text-formatting.pptx')))]
  await page.evaluate(async (data: number[]) => {
    const store = (await import(loaded('deck-store'))) as {
      useDeckStore: { getState: () => { load: (bytes: Uint8Array, path: string) => Promise<void> } }
    }
    await store.useDeckStore.getState().load(new Uint8Array(data), '/decks/text-formatting.pptx')
  }, bytes)

  await expect(page.getByTestId('canvas').getByText('Plain')).toBeVisible()
})

test('grows when the words stop fitting', async ({ page }) => {
  const before = await firstHeight(page)

  await page
    .getByTestId('canvas')
    .getByRole('button', { name: /TextBox/ })
    .first()
    .dblclick()
  await page.keyboard.type(
    Array.from({ length: 14 }, (_, line) => `line ${String(line)}`).join('\n'),
  )
  await page.keyboard.press('Escape')

  await expect.poll(async () => firstHeight(page)).toBeGreaterThan(before)
})
