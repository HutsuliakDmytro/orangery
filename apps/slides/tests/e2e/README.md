# End-to-end tests

Two layers, because one cannot cover both halves of the app.

## Browser tests (`*.spec.ts`, here)

Run against the Vite dev server in Chromium: `pnpm test:e2e`.

They cover what lives inside the webview, which for a deck is most of it:
making a presentation from a template, adding slides, drawing a shape, typing
into it, the outline and the filmstrip, the print view, and **the whole
slideshow** — the show is a route in the same bundle, so a show driven entirely
from the keyboard can be driven here.

They deliberately do **not** use Playwright's `devices['Desktop Chrome']`
preset: it forces a Windows user agent, and the app reads the platform from the
user agent to decide whether `Mod` means Cmd or Ctrl. With a faked UA every
keyboard-shortcut test disagrees with the modifier Playwright sends.

## What is missing here, and where it is covered instead

The plan's end-to-end scenario is "open somebody else's deck → add a slide →
shape and text → save → reopen → PDF". The first, fourth, fifth and sixth of
those are the shell's: there is no file dialog in a browser, no disk to write
to, and the system print sheet is not ours to open. Those commands are
registered disabled without a shell, so a browser test of them would assert
that a greyed-out button is greyed out.

They are covered where the code actually is:

- opening, saving, `.bak` and atomic writes — `src/app/save.test.tsx`,
  `src/document/`, and the Rust tests in `packages/tauri-shared`;
- that a saved deck reopens unchanged — the round-trip corpus in
  `packages/ooxml-presentation`, which is stricter than a click-through: it
  compares every part of the package rather than what the window shows;
- that it renders the same after a round trip — the LibreOffice render-diff job
  in CI;
- printing and PDF — `src/app/print.test.tsx` for the pages, and the QA
  checklist for the system sheet.

That is not the same as driving the real window, and this file exists so the
gap is not mistaken for coverage.

## Shell tests (`tauri-driver`, CI only, not yet written)

`tauri-driver` supports **Linux and Windows only**, because Apple provides no
way to drive a `WKWebView` embedded in an application. What only the shell can
exercise — the native menu, system dialogs, file associations, window close
confirmation, a second window, the show on a second display — is in
`docs/qa-checklist.md` until that job exists.
