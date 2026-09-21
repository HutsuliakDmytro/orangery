# End-to-end tests

Two layers, because one cannot cover both halves of the app.

## Browser tests (`*.spec.ts`, here)

Run against the Vite dev server: `pnpm test:e2e`.

They cover what only a real engine can answer. The grid is a `<canvas>`, and in
jsdom a canvas records nothing and `measureText` answers seven pixels a
character — so the entire question of what this app puts on the screen is
untested until a browser runs it. The unit suite asserts what the grid was
handed. These assert what came out the other end.

The one that matters most is the quietest: opening a workbook must not edit it.
A grid that measures text to decide where a word wraps and how wide a column
wants to be is a grid that can change a file by being looked at, and that is
exactly the bug this shape of test caught in Slides.

## What is missing here, and where it is covered instead

The plan's scenario is "somebody else's workbook → an edit → a formula → sort
and filter → a chart → save → reopen → PDF". Three of those are not in the
webview at all:

- **Opening and saving a file.** There is no file dialog in a browser and no
  disk to write to. The commands are registered disabled without a shell, so a
  browser test of them would assert that a greyed-out button is greyed out.
  What can be done here is the round trip without the disk — bytes written by
  the same writer and read by the same reader — and `editing.spec.ts` does
  that. The disk itself is `src/document/save.test.ts` and the Rust side in
  `packages/tauri-shared`.

- **Formulas.** The engine is Rust behind a Tauri command. In a browser every
  call returns nothing, so a formula typed here stays a formula and never
  becomes a number. It is covered where it is: `cargo test -p formula`, which
  compares against values Excel computed, and `src/document/formula.test.ts`
  for the half that lives in the window.

- **Printing and PDF.** The print view is ours and is covered by
  `src/render/print-view.test.tsx`; the system print sheet is not ours to open,
  and is in the QA checklist.

## Still worth adding

Auto-fitting a column by double-clicking its edge is the sharpest test this
app could have of a real engine: the width that comes out is a measurement in
the browser's own font metrics, and this file format states a column's width in
characters. It is not here yet because finding the edge means computing the
header geometry from the outside. Until it is, `docs/qa-checklist.md` asks for
it by hand.
