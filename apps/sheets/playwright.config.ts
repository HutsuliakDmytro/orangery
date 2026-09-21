import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests.
 *
 * These run against the Vite dev server in a browser, not against the packaged
 * app. `tauri-driver` — the WebDriver bridge Tauri provides — supports Linux
 * and Windows only; macOS is listed as a TODO in its own README, so a
 * shell-level end-to-end cannot run on the primary development platform at all.
 *
 * For a spreadsheet the split falls in a particular place, and it is not the
 * one the other two apps have. The grid is a canvas, so everything about what
 * a sheet *looks* like only happens in a real engine: jsdom's `measureText`
 * answers seven pixels a character and its canvas draws nothing at all. But
 * the formula engine is Rust behind a Tauri command, so nothing here computes
 * a formula — see `tests/e2e/README.md`, which says what that does and does
 * not amount to.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:1440',
    trace: 'on-first-retry',
    // A desktop app, and a sheet is drawn to fill the window; a phone viewport
    // would exercise a layout that does not exist.
    viewport: { width: 1280, height: 840 },
  },

  // Deliberately not `devices['Desktop Chrome']`: that preset forces a Windows
  // user agent, and the app reads the platform from the user agent to decide
  // whether `Mod` means Cmd or Ctrl. A faked UA makes every shortcut test
  // disagree with the modifier Playwright actually sends.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // WebKit runs the spec that is about what an engine does rather than about
    // what this app does: whether it draws a sheet, and whether measuring one
    // edits it. WebKit is what the app runs in on macOS and Chromium is what it
    // runs in on Windows, they measure text differently, and a column's width
    // in this format is stated in characters. The rest of the suite is about
    // the app and does not get better by being run twice.
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
      testMatch: /opening\.spec\.ts/u,
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1440',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
