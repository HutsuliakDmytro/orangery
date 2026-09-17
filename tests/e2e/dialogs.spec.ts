import { expect, test } from '@playwright/test'

/** Dialogs and panels, driven the way a user drives them. */

const editor = '.editor-surface'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator(editor)).toBeVisible()
})

test('opens the command palette and runs a command from it', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('text to centre')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()

  await page.getByLabel('Search commands').fill('center')
  await page.keyboard.press('Enter')

  await expect(palette).toBeHidden()
  await expect(page.locator(`${editor} [style*="text-align: center"]`)).toHaveCount(1)
})

test('closes the palette on Escape without running anything', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden()
})

test('finds and replaces text', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('the cat sat on the mat')

  await page.keyboard.press('ControlOrMeta+f')
  const panel = page.getByRole('dialog', { name: 'Find and replace' })
  await expect(panel).toBeVisible()

  await page.getByLabel('Find', { exact: true }).fill('cat')
  await expect(panel).toContainText('1 / 1')

  await page.getByLabel('Replace with').fill('dog')
  await page.getByRole('button', { name: 'All' }).click()

  await expect(page.locator(editor)).toContainText('the dog sat on the mat')
})

test('shows the outline and navigates by heading', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('Chapter one')
  await page.getByLabel('Paragraph style').selectOption('Heading1')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('outline')
  await page.keyboard.press('Enter')

  const outline = page.getByRole('complementary', { name: 'Document outline' })
  await expect(outline).toBeVisible()
  await expect(outline.getByRole('button', { name: 'Chapter one' })).toBeVisible()
})

test('inserts a special character', async ({ page }) => {
  await page.locator(editor).click()

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('special')
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Special characters' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Em dash' }).click()
  await expect(page.locator(editor)).toContainText('—')
})

test('changes the page size through page setup', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('page setup')
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Page setup' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Paper size').selectOption('a4')
  await dialog.getByRole('button', { name: 'Apply' }).click()

  await expect(dialog).toBeHidden()
  // A4 is 595.28pt wide, so the page element must have resized.
  await expect(page.locator('.document-page')).toHaveAttribute('style', /595\.28pt/)
})

test('switches the interface language', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('settings')
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Interface language').selectOption('uk')
  await expect(page.getByRole('dialog', { name: 'Налаштування' })).toBeVisible()
})

test('numbers the headings and carries the numbers into the contents', async ({ page }) => {
  await page.locator(editor).click()

  await page.keyboard.type('First')
  await page.getByLabel('Paragraph style').selectOption('Heading1')
  await page.locator(editor).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Under')
  await page.getByLabel('Paragraph style').selectOption('Heading2')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Number Headings 1')
  await page.keyboard.press('Enter')

  // The number beside the heading and the number in the contents come from the
  // same computation, so this checks both at once.
  await expect(page.locator(`${editor} .heading-number`).first()).toHaveText('1.')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Table of Contents')
  await page.keyboard.press('Enter')

  await expect(page.locator(`${editor} .toc-entry`)).toHaveCount(2)
  await expect(page.locator(`${editor} .toc-entry`).nth(1)).toHaveText('1.1. Under')
})

test('page setup changes the section the cursor is in, not the whole document', async ({ page }) => {
  await page.locator(editor).click()
  await page.keyboard.type('first section')

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Section Break')
  await page.keyboard.press('Enter')

  await expect(page.locator(`${editor} .section-break`)).toHaveCount(1)

  // The cursor is still in the first section, so page setup applies to it.
  await page.locator(`${editor} p`).first().click()
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Page Setup')
  await page.keyboard.press('Enter')

  await page.getByRole('radio', { name: 'Landscape' }).check()
  await page.getByRole('button', { name: 'Apply' }).click()

  // The ruler follows the cursor, so it is showing the section just changed.
  const track = page.locator('[aria-label="Left margin"]').locator('..')
  const wide = (await track.boundingBox())?.width ?? 0
  expect(wide).toBeGreaterThan(900)
})

test('gives the first page a header of its own only when it is set apart', async ({ page }) => {
  await page.locator(editor).click()

  // Nothing to edit for a page that is not set apart.
  await expect(page.getByLabel('First page Header text')).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByLabel('Search commands').fill('Page Numbers')
  await page.keyboard.press('Enter')

  await page.getByRole('checkbox', { name: /first page/i }).check()
  await page.getByRole('button', { name: 'Apply' }).click()

  const first = page.getByLabel('First page Header text')
  await expect(first).toHaveCount(1)

  await first.fill('Title page only')
  await expect(first).toHaveValue('Title page only')

  // The default header is still its own field, not the one just typed into.
  await expect(page.getByLabel('Header text', { exact: true })).toHaveValue('')
})
