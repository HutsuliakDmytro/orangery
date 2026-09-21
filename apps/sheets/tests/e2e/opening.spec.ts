import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * A workbook opens, and opening it does not change it.
 *
 * The promise the whole engine is built around — open, save, get the same file
 * back — has a step in it that only exists in a real browser. The grid is a
 * canvas: it measures text to decide where a word wraps and how wide a column
 * wants to be, and a measurement is what a sheet can be quietly edited by. In
 * jsdom every measurement is a stub, so the unit suite cannot see it happen.
 *
 * It also cannot see the grid draw at all. `getContext('2d')` there answers
 * with something that records nothing, which means the whole of what this app
 * puts on the screen is untested until a browser runs it.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/xlsx')

const LOADED = `window.loaded = (name) => {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name)
  return entries.find((entry) => entry.includes(name)) ?? name
}`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(LOADED)
  await page.goto('/')
  // The app with nothing in it, which is what says the modules have been
  // fetched — and `loaded` can only answer about a module that has.
  await expect(page.getByText('No workbook open')).toBeVisible()
})

/** The fixture loaded into the store the way the shell would load it. */
const open = async (page: Page, name: string) => {
  const bytes = [...new Uint8Array(await readFile(join(FIXTURES, name)))]

  return await page.evaluate(
    async (workbook: { bytes: number[]; name: string }) => {
      const store = (await import(loaded('workbook-store'))) as {
        useWorkbookStore: {
          getState: () => {
            load: (bytes: Uint8Array, path: string) => Promise<void>
            edited: boolean
            history: { past: unknown[] }
          }
        }
      }

      await store.useWorkbookStore
        .getState()
        .load(new Uint8Array(workbook.bytes), `/books/${workbook.name}`)

      // Long enough for the layout effects that measure text to have run.
      await new Promise((resolve) => setTimeout(resolve, 600))

      const after = store.useWorkbookStore.getState()
      return { edited: after.edited, steps: after.history.past.length }
    },
    { bytes, name },
  )
}

test('opening a workbook is not editing it', async ({ page }) => {
  const state = await open(page, 'budget.xlsx')

  // Nothing typed, nothing to undo, and nothing that would make a save write
  // a different file from the one that was read.
  expect(state).toEqual({ edited: false, steps: 0 })
})

test('a workbook with macros opens and says so', async ({ page }) => {
  const state = await open(page, 'macros.xlsm')

  expect(state.edited).toBe(false)
  await expect(page.getByRole('status')).toContainText('macros')
})

test('the sheet is drawn, and not merely handed to something', async ({ page }) => {
  await open(page, 'budget.xlsx')

  const grid = page.getByRole('grid', { name: 'Budget' })
  await expect(grid).toBeVisible()

  // The canvas itself, asked what is on it. Everything in the unit suite
  // asserts what the grid was given; this is the only place that can ask what
  // came out the other end.
  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (canvas === null) return null

    const context = canvas.getContext('2d')
    if (context === null) return null

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const colours = new Set<string>()
    for (let at = 0; at < data.length; at += 4) {
      colours.add(`${String(data[at])},${String(data[at + 1])},${String(data[at + 2])}`)
    }

    return { colours: colours.size, width: canvas.width, height: canvas.height }
  })

  expect(drawn).not.toBeNull()
  expect(drawn?.width).toBeGreaterThan(0)
  // Cells, gridlines, headers and text: a blank canvas has one colour and a
  // drawn sheet has many. Counting them rather than comparing an image,
  // because a screenshot of a grid is a test that fails when a font updates.
  expect(drawn?.colours ?? 0).toBeGreaterThan(3)
})
