import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests.
 *
 * These run against the Vite dev server in a browser, not against the packaged
 * app. `tauri-driver` — the WebDriver bridge Tauri provides — supports Linux and
 * Windows only; macOS is listed as a TODO in its own README, so a shell-level
 * e2e cannot run on the primary development platform at all.
 *
 * The split is therefore deliberate:
 *   - browser e2e (here) covers everything that lives in the webview: editing,
 *     formatting, tables, the toolbar, the palette, dialogs;
 *   - file open/save, the native menu and window behaviour are covered by the
 *     Rust tests and the document-level integration tests, which exercise the
 *     same code the shell calls;
 *   - a `tauri-driver` job runs on Linux in CI for the shell itself.
 *
 * Anything asserted here would behave identically in the webview, because it is
 * the same bundle.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    // The app is desktop-only; a phone viewport would exercise layout that does
    // not exist.
    viewport: { width: 1280, height: 840 },
  },

  // Deliberately not `devices['Desktop Chrome']`: that preset forces a Windows
  // user agent, and the app reads the platform from the user agent to decide
  // whether `Mod` means Cmd or Ctrl. A faked UA makes every shortcut test
  // disagree with the modifier Playwright actually sends.
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
