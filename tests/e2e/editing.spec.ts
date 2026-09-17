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

/**
 * A list with no marker is not a list on the page, however right the markup is.
 * Nothing below the browser can catch this: the framework's own reset strips
 * the marker, and every unit test still sees a correct `<ul><li>`.
 */
test('draws a marker on every kind of list', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('first')

  await page.getByRole('button', { name: 'Numbered List' }).click()
  await expect(page.locator(`${editor} ol li`)).toHaveCount(1)

  const markerOf = (selector: string): Promise<string> =>
    page
      .locator(selector)
      .first()
      .evaluate((node: Element): string => getComputedStyle(node).listStyleType)

  expect(await markerOf(`${editor} ol`)).toBe('decimal')

  await page.keyboard.press('Enter')
  await page.keyboard.type('second')
  await page.keyboard.press('Tab')

  // A nested level has a marker of its own, so it reads as nested.
  expect(await markerOf(`${editor} ol ol`)).toBe('lower-alpha')

  await page.getByRole('button', { name: 'Bulleted List' }).click()
  expect(await markerOf(`${editor} ul`)).toBe('disc')
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

test('replaces quotes, dashes and the ellipsis while typing', async ({ page }) => {
  await page.locator(editor).click()
  // Typed through the browser's own input, which is the only place the rules
  // fire: they run on text input and deliberately not on paste.
  await page.keyboard.type('he said "hello" wait... a--b')

  await expect(page.locator(`${editor} p`).first()).toHaveText('he said “hello” wait… a—b')
})

test('picks the quotation marks from the language being typed', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('він сказав "привіт"')

  await expect(page.locator(`${editor} p`).first()).toHaveText('він сказав «привіт»')
})

/**
 * A tab stop only means anything once the page is laid out: the width of a tab
 * is measured from where the character actually landed, which nothing below a
 * browser can tell us.
 */
test('widens a tab to reach its stop and draws the leader', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('Chapter one')
  await page.keyboard.press('Tab')
  await page.keyboard.type('5')

  const tab = page.locator(`${editor} .doc-tab`)
  await expect(tab).toHaveCount(1)

  const widthOf = () => tab.evaluate((node: Element) => node.getBoundingClientRect().width)

  // With no stop of its own the paragraph falls back to the regular interval.
  // Awaited rather than read at once: the width is measured after layout, so it
  // lands a frame behind the character.
  await expect(tab).toHaveAttribute('data-leader', 'none')
  const fallback = await widthOf()

  // A stop far to the right, clicked onto the ruler where Word puts them.
  const track = page.locator('[aria-label="Left margin"]').locator('..')
  const bounds = await track.boundingBox()
  await track.click({ position: { x: (bounds?.width ?? 600) * 0.8, y: 2 } })

  const marker = page.getByRole('button', { name: /tab stop/ })
  await expect(marker).toHaveCount(1)

  // Alt-click changes what fills the gap; a plain click changes the alignment.
  await marker.click({ modifiers: ['Alt'] })
  await expect(page.getByRole('button', { name: /with dot leader/ })).toHaveCount(1)

  await expect(tab).toHaveAttribute('data-leader', 'dot')
  expect(await widthOf()).toBeGreaterThan(fallback)
})

test('types a tab in the middle of a line and indents at its start', async ({ page }) => {
  await page.locator(editor).click()

  // At the start of a paragraph Tab indents, as it does in Word.
  await page.keyboard.press('Tab')
  await expect(page.locator(`${editor} .doc-tab`)).toHaveCount(0)
  await expect(page.locator(`${editor} p[style*="margin-left"]`)).toHaveCount(1)

  await page.keyboard.type('text')
  await page.keyboard.press('Tab')
  await expect(page.locator(`${editor} .doc-tab`)).toHaveCount(1)
})

test('records what is typed and deleted as tracked changes', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('the original text')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Track Changes')
  await page.keyboard.press('Enter')

  // Select-all goes through the editor's own keymap, so the selection is where
  // the next keystroke will see it — a click or an arrow key is reported by the
  // browser a task later.
  await page.locator(editor).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('replacement')

  // The old text stays, struck through, until somebody decides.
  await expect(page.locator(`${editor} .revision-deletion`)).toHaveCount(1)
  await expect(page.locator(`${editor} .revision-insertion`)).toHaveCount(1)
  await expect(page.locator(`${editor} p`).first()).toContainText('the original text')
  await expect(page.locator(`${editor} p`).first()).toContainText('replacement')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Reject Tracked Changes')
  await page.keyboard.press('Enter')

  await expect(page.locator(`${editor} p`).first()).toHaveText('the original text')
  await expect(page.locator(`${editor} .revision-insertion`)).toHaveCount(0)
})
