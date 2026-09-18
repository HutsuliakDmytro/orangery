import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Presenting, driven entirely from the keyboard.
 *
 * The one screen that must never fail (CLAUDE.md), and the one an end-to-end
 * test can actually reach: the show is a route in the same bundle, so
 * everything except the second display happens here. What is left — the
 * projector, the presenter view on another panel, sleep and unplugging — is in
 * `docs/presenting-checklist.md`, which needs hardware.
 */

const show = (page: Page) => page.getByTestId('show')

/** A deck with enough slides that running off the end means something. */
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
})

test('starts on F5 and fills the window', async ({ page }) => {
  await page.keyboard.press('F5')

  await expect(show(page)).toBeVisible()
  await expect(show(page)).toHaveClass(/fixed inset-0/)
})

test('runs from the first slide to the last on the space bar', async ({ page }) => {
  await page.keyboard.press('F5')
  await expect(show(page)).toContainText('Subject')

  for (let step = 0; step < 6; step += 1) await page.keyboard.press('Space')
  await expect(show(page)).toContainText('Summary')

  // Past the end the show holds rather than falling out of itself; leaving is
  // something the presenter does, not something the deck does to them.
  await page.keyboard.press('Space')
  await expect(show(page)).toBeVisible()
  await expect(show(page)).toContainText('Summary')
})

test('goes back the way it came', async ({ page }) => {
  await page.keyboard.press('F5')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(show(page)).toContainText('First idea')

  await page.keyboard.press('ArrowLeft')
  await expect(show(page)).toContainText('Today')
})

test('jumps to a slide by number', async ({ page }) => {
  await page.keyboard.press('F5')

  await page.keyboard.press('7')
  await expect(page.getByTestId('typed')).toHaveText('7')
  await page.keyboard.press('Enter')

  await expect(show(page)).toContainText('Summary')
})

test('blanks the screen and comes back', async ({ page }) => {
  await page.keyboard.press('F5')

  await page.keyboard.press('b')
  await expect(page.getByTestId('blank')).toBeVisible()

  await page.keyboard.press('b')
  await expect(page.getByTestId('blank')).toBeHidden()

  await page.keyboard.press('w')
  await expect(page.getByTestId('blank')).toHaveClass(/bg-white/)
})

test('ends on Escape and gives the editor back', async ({ page }) => {
  await page.keyboard.press('F5')
  await expect(show(page)).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(show(page)).toBeHidden()
  await expect(page.getByTestId('canvas')).toBeVisible()
})

test('starts from the slide being shown, not from the beginning', async ({ page }) => {
  await page.getByRole('button', { name: 'Slide 4' }).click()
  await page.keyboard.press('Shift+F5')

  await expect(show(page)).toContainText('The idea')
})

test('goes end to end and back to the editor without touching the mouse', async ({ page }) => {
  // The scenario the plan asks for, as one run: start, through every slide,
  // out again.
  await page.keyboard.press('F5')
  await expect(show(page)).toBeVisible()

  for (let step = 0; step < 6; step += 1) await page.keyboard.press('PageDown')
  await expect(show(page)).toContainText('Summary')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Slide \d+$/ })).toHaveCount(7)
})
