import { expect, test } from '@playwright/test'

/**
 * What the menu bar is told, checked where it can be checked.
 *
 * The bug: with a document open and text selected, Edit → Copy was greyed out
 * in the native menu while Cmd-C copied perfectly well. The registry knew the
 * command could run; the menu bar did not.
 *
 * The menu bar itself is an `NSMenu` and reaching one needs `tauri-driver`,
 * which has no macOS support — its own README says so, and this repository's
 * `playwright.config.ts` says it too. So the halves are tested where each of
 * them lives:
 *
 *   - here, in the browser: that the registry's answer changes with the
 *     selection, which is the answer the menu bar is sent;
 *   - `packages/ui-kit/src/commands/use-native-menu.test.tsx`: that the answer
 *     is sent, without rebuilding the bar, every time it changes;
 *   - `packages/tauri-shared/src/menu.rs`: that a descriptor without an
 *     `enabled` field is an enabled item;
 *   - the `tauri-driver` job on Linux: the three together, against a real bar.
 *
 * The toolbar is the surface under test because it reads the registry the same
 * way the menu does — `useCommand` calls `isCommandEnabled`, and so does
 * `describeCommands`. A toolbar button that is live is a menu item that was
 * sent `enabled: true`.
 */

const editor = '.editor-surface'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator(editor)).toBeVisible()

  await page.locator(editor).click()
  await page.keyboard.type('Something worth selecting')
})

test('a selection makes the commands that need one live', async ({ page }) => {
  await page.keyboard.press('Shift+Home')

  await expect(page.getByRole('button', { name: 'Bold' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Italic' })).toBeEnabled()
})

test('the commands that need a document are live as soon as there is one', async ({ page }) => {
  // Nothing is selected here: `Copy` needs a selection, `Bold` needs a
  // document, and the menu bar has to tell them apart.
  await expect(page.getByRole('button', { name: 'Bold' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
})

test('undo goes back to being unavailable when there is nothing to undo', async ({ page }) => {
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeEnabled()

  // Back to the empty document the welcome screen made.
  for (let press = 0; press < 30; press += 1) await page.keyboard.press('ControlOrMeta+z')

  await expect(undo).toBeDisabled()
})
