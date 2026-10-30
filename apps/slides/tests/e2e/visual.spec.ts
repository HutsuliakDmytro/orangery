import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * What the shared components look like in this app, as pixels.
 *
 * `packages/ui-kit` is styled with Tailwind utilities, and Tailwind writes only
 * the utilities it finds in the sources it is told about. For a long time it
 * was not told about ui-kit, so its components were drawn with whichever of
 * their classes this app happened to use itself — a dialog with no width, a
 * card that came out a different size in every window. jsdom does not draw,
 * so not one unit test could see it.
 *
 * These are the baseline that makes the next such gap visible: every shared
 * component, alone on `gallery.html` with this app's stylesheet, in both
 * themes, and the app's own toolbar and palette in place. macOS only — the
 * baselines are pixels from one renderer, and fonts differ by platform.
 *
 * Update after a deliberate visual change:
 *   pnpm --filter slides test:e2e visual --update-snapshots
 */

test.skip(process.platform !== 'darwin', 'baselines are macOS pixels')

const THEMES = ['dark', 'light'] as const
const SECTIONS = [
  'toolbar',
  'palette',
  'confirm',
  'color',
  'popover',
  'recent',
  'error',
  'launch-failure',
  'launch-opening',
  'previous-run',
  'recovery',
] as const

/** Gets a section to the state worth drawing. */
async function prepare(page: Page, section: string): Promise<void> {
  if (section === 'palette') {
    // Out of the way: the palette opens in the middle of the window, and a
    // row under the pointer is the highlighted one.
    await page.mouse.move(0, 0)
    await page.keyboard.press('ControlOrMeta+Shift+P')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  }
  if (section === 'recent') {
    await page.getByRole('button', { name: /Recent/ }).click()
    await expect(page.getByRole('menu')).toBeVisible()
  }
  if (section === 'launch-failure') await expect(page.getByRole('alert')).toBeVisible()
  if (section === 'launch-opening') await expect(page.getByRole('status')).toBeVisible()
  if (section === 'previous-run') await expect(page.getByRole('status')).toBeVisible()
  if (section === 'error') await expect(page.getByRole('alert')).toBeVisible()
}

for (const theme of THEMES) {
  for (const section of SECTIONS) {
    test(`${section}, ${theme}`, async ({ page }) => {
      await page.goto(`/gallery.html?show=${section}&theme=${theme}`)
      await expect(page.locator(`[data-gallery="${section}"]`)).toBeVisible()
      await prepare(page, section)
      await expect(page).toHaveScreenshot(`${section}-${theme}.png`)
    })
  }

  test(`the app's own chrome, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/')
    await page.getByRole('button', { name: 'New Presentation' }).click()
    await expect(page.getByRole('button', { name: /^Slide 1$/ })).toBeVisible()
    await page.evaluate((chosen) => {
      document.documentElement.dataset['theme'] = chosen
    }, theme)
    await expect.soft(page).toHaveScreenshot(`app-${theme}.png`)

    await page.mouse.move(0, 0)
    await page.keyboard.press('ControlOrMeta+Shift+P')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    await expect.soft(page).toHaveScreenshot(`app-palette-${theme}.png`)
  })
}
