import { expect, test } from '@playwright/test'

/**
 * The core editing flow, end to end in a real browser engine.
 *
 * These cover what unit tests cannot: that the toolbar, the editor and the
 * command registry agree once they are all mounted together.
 */

const editor = '.editor-surface'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // The welcome screen stands in front of the editor on a fresh document.
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator(editor)).toBeVisible()
})

test('types text into the document', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('Hello from the editor')

  await expect(page.locator(editor)).toContainText('Hello from the editor')
})

test('applies bold through the toolbar and reflects it in the button state', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('bold me')
  // `ControlOrMeta` resolves to Cmd on macOS; `Control+a` there is the emacs
  // "move to line start" binding, not select-all.
  await page.keyboard.press('ControlOrMeta+a')

  const bold = page.getByRole('button', { name: 'Bold' })
  await bold.click()

  await expect(page.locator(`${editor} strong`)).toHaveText('bold me')
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
})

test('applies a heading through the style dropdown', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('A heading')

  await page.getByLabel('Paragraph style').selectOption('Heading1')

  await expect(page.locator(`${editor} h1`)).toHaveText('A heading')
})

test('inserts a list and nests an item', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('first')

  await page.getByRole('button', { name: 'Bulleted List' }).click()
  await expect(page.locator(`${editor} ul li`)).toHaveCount(1)

  await page.keyboard.press('Enter')
  await page.keyboard.type('second')
  await page.keyboard.press('Tab')

  await expect(page.locator(`${editor} ul ul li`)).toHaveCount(1)
})

test('inserts a table from the grid picker', async ({ page }) => {
  await page.locator(editor).click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()

  // The button opens the drag-a-grid picker, as Word and Docs do.
  const picker = page.getByRole('dialog', { name: 'Insert table' })
  await expect(picker).toBeVisible()

  await picker.getByRole('gridcell', { name: '3 by 4' }).click()

  await expect(page.locator(`${editor} table`)).toBeVisible()
  await expect(page.locator(`${editor} table tr`)).toHaveCount(3)
  await expect(page.locator(`${editor} table tr`).first().locator('td')).toHaveCount(4)

  await page.locator(`${editor} table td`).first().click()
  await page.keyboard.type('cell text')

  await expect(page.locator(`${editor} table`)).toContainText('cell text')
})

test('undo and redo walk the history', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('typed once')
  await expect(page.locator(editor)).toContainText('typed once')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator(editor)).not.toContainText('typed once')

  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.locator(editor)).toContainText('typed once')
})

test('counts words in the status bar once typing pauses', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('one two three four')

  // The count is deferred so it does not run on every keystroke.
  await expect(page.getByText('4 words')).toBeVisible({ timeout: 5000 })
})
