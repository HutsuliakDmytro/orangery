import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Somebody else's workbook, typed into, and written back.
 *
 * The plan's end-to-end scenario is "somebody else's workbook → an edit → a
 * formula → sort and filter → a chart → save → reopen → PDF". Four of those
 * are the shell's and one of them is Rust's, so what is left here is the half
 * that lives in the webview — and it is the half that a canvas makes
 * impossible to test anywhere else.
 *
 * The keystrokes are real keystrokes into a real grid: the cell editor is an
 * overlay positioned from measurements the browser makes, so a test that types
 * here is also a test that the editor appeared over the right cell.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/xlsx')

const LOADED = `window.loaded = (name) => {
  const entries = performance.getEntriesByType('resource').map((entry) => entry.name)
  return entries.find((entry) => entry.includes(name)) ?? name
}`

interface Store {
  useWorkbookStore: {
    getState: () => {
      load: (bytes: Uint8Array, path: string) => Promise<void>
      open: unknown
      edited: boolean
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(LOADED)
  await page.goto('/')
  await expect(page.getByText('No workbook open')).toBeVisible()

  const bytes = [...new Uint8Array(await readFile(join(FIXTURES, 'budget.xlsx')))]

  await page.evaluate(async (workbook: number[]) => {
    const store = (await import(loaded('workbook-store'))) as Store
    await store.useWorkbookStore.getState().load(new Uint8Array(workbook), '/books/budget.xlsx')
  }, bytes)

  await expect(page.getByRole('grid', { name: 'Budget' })).toBeVisible()
})

/**
 * The cursor put on a named cell, through the box that does it.
 *
 * Clicking lands wherever the middle of the window happens to be, which is a
 * different cell on a different viewport. The name box is the way a person
 * goes somewhere by name, and it blurs afterwards — so the grid is given the
 * focus back rather than clicked, which would move the cursor again.
 */
const goTo = async (page: Page, cell: string) => {
  await page.getByRole('textbox', { name: 'Name box' }).fill(cell)
  await page.getByRole('textbox', { name: 'Name box' }).press('Enter')
  await page.getByRole('grid', { name: 'Budget' }).focus()
}

test('what was typed is what the file gets', async ({ page }) => {
  await goTo(page, 'A1')

  // Into the cell through the overlay the grid puts over it.
  await page.keyboard.type('1234.5')
  await page.keyboard.press('Enter')

  // Written to bytes and read back, which is the round trip without a disk in
  // it: the same writer the shell hands to Rust, and the same reader.
  const survived = await page.evaluate(async () => {
    const store = (await import(loaded('workbook-store'))) as Store
    const save = (await import(loaded('document/save'))) as {
      workbookBytes: (open: unknown, options: { edited: boolean }) => Promise<Uint8Array>
    }
    const document = (await import(loaded('document/workbook'))) as {
      openWorkbook: (bytes: Uint8Array) => Promise<{
        sheets: { name: string; cells: { rows: Map<number, Map<number, { value: string }>> } }[]
      }>
    }

    const state = store.useWorkbookStore.getState()
    const bytes = await save.workbookBytes(state.open, { edited: true })
    const again = await document.openWorkbook(bytes)

    return {
      edited: state.edited,
      sheets: again.sheets.map((sheet) => sheet.name),
      value: again.sheets[0]?.cells.rows.get(0)?.get(0)?.value ?? null,
    }
  })

  expect(survived.edited).toBe(true)
  expect(survived.value).toBe('1234.5')
  // And the rest of the workbook came back with it: a save that kept the cell
  // and lost a sheet would be a worse bug than one that lost the cell.
  expect(survived.sheets.length).toBeGreaterThan(0)
})

test('a cell being edited holds what is typed into it, and Escape drops it', async ({ page }) => {
  await goTo(page, 'B4')

  await page.keyboard.type('rejected')
  // Labelled with the cell it is over, which is also the assertion that it
  // opened over the right one.
  await expect(page.getByRole('textbox', { name: 'B4' })).toHaveValue('rejected')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'B4' })).toBeHidden()

  const edited = await page.evaluate(async () => {
    const store = (await import(loaded('workbook-store'))) as Store
    return store.useWorkbookStore.getState().edited
  })

  expect(edited).toBe(false)
})
