import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Making a deck, end to end in a real browser engine.
 *
 * What unit tests cannot reach: that the welcome screen, the template builder,
 * the command registry, the filmstrip and the canvas all agree once they are
 * mounted together and driven by a pointer and a keyboard.
 */

/**
 * Runs a command by name through the palette, which is what it is for.
 *
 * The palette rather than the menu: the menu is native, and native is the half
 * of the app a browser cannot reach.
 */
async function run(page: Page, name: string) {
  await page.keyboard.press('ControlOrMeta+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()

  await palette.getByRole('textbox', { name: 'Search commands' }).fill(name)
  await palette.getByRole('button', { name }).first().click()
  await expect(palette).toBeHidden()
}

const slides = (page: Page) => page.getByRole('button', { name: /^Slide \d+$/ })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('starts from a template and builds the deck it promised', async ({ page }) => {
  await page.getByRole('button', { name: 'New from Template…' }).click()

  const chooser = page.getByRole('dialog', { name: 'New Presentation' })
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: /Pitch/ }).click()

  await expect(slides(page)).toHaveCount(6)
  await expect(page.getByTestId('canvas')).toContainText('Company')
})

test('adds a slide after the one being shown', async ({ page }) => {
  await page.getByRole('button', { name: 'New Presentation' }).click()
  await expect(slides(page)).toHaveCount(1)

  await run(page, 'New Slide')

  await expect(slides(page)).toHaveCount(2)
})

test('draws a shape and puts words in it', async ({ page }) => {
  await page.getByRole('button', { name: 'New Presentation' }).click()
  await run(page, 'Rectangle')

  const canvas = page.getByTestId('canvas')
  const shape = canvas.getByRole('button', { name: /Rect/ }).first()
  await expect(shape).toBeVisible()

  // A double click is how you get inside a shape's text, here and in every
  // other program that draws one.
  await shape.dblclick()

  // Waited for rather than typed straight into: the editor is a ProseMirror
  // view that React mounts on the next commit, and Playwright types faster than
  // that. A person cannot, which is why this is a wait and not a bug.
  const typing = page.locator('[contenteditable="true"]')
  await expect(typing).toBeVisible()

  await page.keyboard.type('Hello from a rectangle')
  await page.keyboard.press('Escape')

  await expect(canvas).toContainText('Hello from a rectangle')
})

test('shows the words on the slide in the outline too', async ({ page }) => {
  await page.getByRole('button', { name: 'New from Template…' }).click()
  await page
    .getByRole('dialog', { name: 'New Presentation' })
    .getByRole('button', { name: /Lecture/ })
    .click()
  await expect(slides(page)).toHaveCount(7)

  await run(page, 'Outline View')

  await expect(page.getByRole('complementary', { name: 'Outline' })).toContainText('Subject')
})

test('undoes an added slide', async ({ page }) => {
  await page.getByRole('button', { name: 'New Presentation' }).click()
  await run(page, 'New Slide')
  await expect(slides(page)).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(slides(page)).toHaveCount(1)
})
