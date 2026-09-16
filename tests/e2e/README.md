# End-to-end tests

Two layers, because one cannot cover both halves of the app.

## Browser tests (`*.spec.ts`, here)

Run against the Vite dev server in Chromium: `pnpm test:e2e`.

They cover everything that lives inside the webview — editing, formatting,
tables, the toolbar, the command palette, dialogs, the outline, find and
replace. That is the same bundle the packaged app loads, so behaviour asserted
here holds there.

They deliberately do **not** use Playwright's `devices['Desktop Chrome']`
preset: it forces a Windows user agent, and the app reads the platform from the
user agent to decide whether `Mod` means Cmd or Ctrl. With a faked UA every
keyboard-shortcut test disagrees with the modifier Playwright sends.

## Shell tests (`tauri-driver`, CI only)

`tauri-driver` — Tauri's WebDriver bridge — supports **Linux and Windows only**.
macOS is listed as a TODO in its own README, because Apple provides no way to
drive a `WKWebView` embedded in an application. So the shell-level suite cannot
run on the primary development platform at all, and lives in CI on Linux.

What only the shell can exercise:

- the native menu bar and its accelerators,
- system file dialogs, and open/save through them,
- window behaviour: close confirmation, multiple windows, file associations,
- printing.

Until that job exists, those paths are covered by the Rust tests in
`src-tauri/src/document.rs` and the document-level tests in `src/document/`,
which exercise the same code the shell calls. That is not the same as driving
the real window, and this file exists so the gap is not mistaken for coverage.
