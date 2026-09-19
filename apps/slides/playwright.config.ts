import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests.
 *
 * These run against the Vite dev server in a browser, not against the packaged
 * app. `tauri-driver` — the WebDriver bridge Tauri provides — supports Linux and
 * Windows only; macOS is listed as a TODO in its own README, so a shell-level
 * e2e cannot run on the primary development platform at all.
 *
 * For a deck that means the split falls in a particular place: making,
 * editing and **presenting** a deck all live in the webview and are here.
 * Opening and saving a file do not — they are the shell's, and they are covered
 * by the document-level tests that exercise the same code the shell calls. See
 * `tests/e2e/README.md`, which says what that does and does not amount to.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:1430',
    trace: 'on-first-retry',
    // The app is desktop-only, and a deck is drawn to fill the window; a phone
    // viewport would exercise a layout that does not exist.
    viewport: { width: 1280, height: 840 },
  },

  // Deliberately not `devices['Desktop Chrome']`: that preset forces a Windows
  // user agent, and the app reads the platform from the user agent to decide
  // whether `Mod` means Cmd or Ctrl. A faked UA makes every shortcut test
  // disagree with the modifier Playwright actually sends.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // WebKit runs the two specs that are about what an engine does rather than
    // about what this app does: whether it turns a slide into pixels, and what
    // it measures a slide's text to be. WebKit is what the app runs in on
    // macOS and Chromium is what it runs in on Windows, and they disagree. The
    // rest of the suite is about the app and does not get faster by being run
    // twice.
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
      testMatch: /(raster|opening)\.spec\.ts/u,
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1430',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
