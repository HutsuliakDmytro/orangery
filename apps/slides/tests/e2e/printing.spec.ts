import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The deck on paper, which is also the deck as a PDF.
 *
 * Both come out of the browser's own print pipeline: the print view is in the
 * tree all the time, takes no space on screen, and everything else steps aside
 * under `@media print`. Which means the whole feature is a stylesheet that only
 * does anything in a mode no unit test runs in — and it did nothing at all. The
 * app is mounted inside `#root`, the rule hid every child of the body that was
 * not the app's own root, and `#root` is one: a seven-slide deck printed as a
 * single blank sheet.
 *
 * Both engines, because printing is the engine's own pipeline and the two of
 * them paginate differently.
 */

/** A deck with enough slides that a page count means something. */
async function deck(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New from Template…' }).click()
  await page
    .getByRole('dialog', { name: 'New Presentation' })
    .getByRole('button', { name: /Lecture/ })
    .click()
  await expect(page.getByRole('button', { name: /^Slide \d+$/ })).toHaveCount(7)
}

test.beforeEach(async ({ page }) => {
  await deck(page)
  await page.emulateMedia({ media: 'print' })
})

test('gives every slide a page, with its words on it', async ({ page }) => {
  const pages = page.getByTestId('print-page')
  await expect(pages).toHaveCount(7)

  for (const one of await pages.all()) {
    // A page of nothing is what a print view with no size produces, and it
    // produces one for every slide just the same.
    const box = await one.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(100)
  }

  await expect(pages.first()).toContainText('Subject')
  await expect(pages.last()).toContainText('Summary')
})

test('leaves the app behind', async ({ page }) => {
  // The filmstrip, the toolbar and the panels are the screen's, not paper's.
  await expect(page.getByRole('button', { name: /^Slide 1$/ })).toBeHidden()
  await expect(page.getByTestId('print-view')).toBeVisible()
})

test('prints a page per slide, through the pipeline that makes the PDF', async ({
  page,
  browserName,
}) => {
  // `page.pdf` is Chromium's own; the check above is what the other engine can
  // answer. This one is the real thing: the bytes a person would be handed.
  test.skip(browserName !== 'chromium', 'PDF generation is Chromium-only in Playwright')

  const pdf = await page.pdf()
  const pages = pdf.toString('latin1').split('/Type /Page').length - 1

  // One entry per page plus the `/Type /Pages` node that holds them.
  expect(pages).toBeGreaterThanOrEqual(7)
  expect(pdf.length).toBeGreaterThan(10_000)
})
