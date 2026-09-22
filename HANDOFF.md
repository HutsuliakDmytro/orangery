# Handoff — where this stands, 2026-09-22

Written so that somebody who has never seen the repository can say what should
happen next. It states what exists, what shipped, what is open and what is
waiting on what. Everything here is checkable: if a claim and the code
disagree, the code is right and this file is stale.

## The one-paragraph version

Orangery is a desktop office suite whose native format is OOXML — not an
import format, the format. Three apps: **Docs** (`.docx`), **Slides**
(`.pptx`) and **Sheets** (`.xlsx`). The guarantee they are all built around is
that opening a file and saving it without edits gives back the file that was
opened, byte for byte, for every part the app has no opinion about. Two of the
three shipped their first pre-release yesterday, for macOS, Windows and Linux.
The next work is not more features — it is putting the three apps in front of
people and collecting the real files that break them, because everything that
broke in the last week was found by a person looking at a screen and none of it
by the 5,481 automated tests.

## Where things are

- Branch: `main`. Everything is merged; nothing is in flight.
- Releases: `sheets-v0.1.0` and `slides-v0.1.0`, both pre-release, both with
  four assets (macOS universal `.dmg`, Windows `.exe`, `.deb`, `.AppImage`).
  Docs is at the older `v0.1.0` tag and has not been re-released.
- CI: `check.yml` (lint, typecheck, unit, e2e on three OSes, LibreOffice
  render-diff, clippy, cargo test) and `build.yml` (three apps × three
  platforms; a `<app>-v*` tag publishes a GitHub release). Green.
- Tests: 5,202 TypeScript unit tests, 279 Rust tests, ~70 Playwright e2e per
  app. Timed benchmarks are opt-in by name, not part of `pnpm check`
  (`pnpm --filter <app> test:speed`, `cargo test -p formula -- --ignored`).

## What each app is

**Docs** — word processor. Styles, numbering, tables, sections, headers and
footers, comments, track changes, ODT/RTF/MD/HTML conversion, print and PDF.
93 plan items done, 9 open.

**Slides** — presentation editor. Masters, layouts, placeholder inheritance,
shapes with DrawingML geometry, tables, text with PowerPoint's autofit,
animations and transitions read and played, a slideshow with presenter view,
pen and laser, ODP, raster export. 121 done, 21 open.

**Sheets** — spreadsheet. A `<canvas>` grid that scrolls a million rows,
a streaming `sheetData` reader, Excel number formats, a formula engine in Rust
(250+ functions, incremental recalculation on a dependency graph, dynamic
arrays with spill, Goal Seek, defined names, structured table references),
charts on a sheet, sorting, filtering, tables, conditional formatting,
validation, CSV wizard and ODS conversion, print and PDF. 43 done, 49 partly
done with notes, 12 open.

Shared: `packages/ooxml-core` (the package: zip, relationships, content types,
passthrough), `ooxml-drawingml`, `ooxml-presentation`, `ooxml-spreadsheet`,
`charts` (one `c:*` model and SVG renderer for all three apps), `grid`,
`numfmt`, `editor-text`, `ui-kit`, `fonts`, `platform`, `render-diff`,
`tauri-shared`, and the Rust crate `crates/formula`.

## Measured, not hoped for

- 200k-cell workbook opens in **0.15 s** (was 1.27 s until three readers
  stopped building an XML tree of the whole sheet to reach an element beside
  `sheetData` rather than inside it).
- 1M rows × 5 columns, 251 MB of zipped XML: opens in **4.8 s** against a
  budget of 5, model costs **~1.0 GB** against a budget of 1. Both inside,
  **both with no margin**. The cost is known: 540 ns per cell to parse (four
  regexes and two objects each) and ~200 bytes per cell retained (a cell object
  whose number is stored as a string, plus a Map entry per row).
- 1M formulas recalculate in **1.85 s**; one edit with 10k dependents in
  **7 ms**; 100k formulas in a chain in **0.15 s**.
- A viewport of cells formats in **0.84 ms** against a budget of 8.

## What is open, and why

### Waiting on real files — three items, one cause

`tests/fixtures/office/` is **empty**. Every fixture in the repository is
synthetic, written by a generator to hold exactly what the test that reads it
needs. Nothing here has ever been written by Word, PowerPoint, Excel, Google or
LibreOffice. Three plan items are blocked on this and cannot be unblocked by
writing more code:

- 30+ real workbooks for the `.xlsx` round-trip corpus;
- 20 workbooks with formulas, to check our results against the values Excel
  cached in the file — the only way to test "the numbers are right" that is not
  testing ourselves against ourselves;
- 30 charts for a render diff against PowerPoint and Excel.

The harnesses all exist and skip when the directory is empty
(`packages/charts/src/corpus.test.ts`, `apps/slides/src/test/corpus.test.tsx`,
`apps/slides/tests/e2e/corpus.spec.ts`). They read `ORANGERY_CORPUS` so a file
that cannot be committed never has to be.

This is not theoretical. The first real deck anybody pointed at this found a
bug in an hour.

### Never done by hand

`docs/qa-checklist.md` exists for each app (Sheets 71 items, Slides 143 plus a
separate projector checklist, Docs 42) and **has not been run once**. No human
has installed the shipped build and looked at it. Beta testing has not started.

### Deferred on purpose — do not "fix" these

- **Signing and notarization** — `[-]` in every plan, deliberately. This is why
  the releases are pre-release and why macOS and Windows warn.
- Engineering and database functions in the formula engine, until somebody asks.
- Text to columns, Remove duplicates, Flash Fill.
- Solver (Goal Seek is done).
- Pivot table _editing_ — pivots render from cached values and are carried
  back untouched.

### Update 1 — Windows and Linux

Now concrete, because both platforms build and their e2e is green:

- Ctrl shortcuts and `Alt` menus.
- WebKitGTK canvas performance on Linux — the plan says to check this early
  because it may be worse than WebView2, and nobody has.
- Fonts: Calibri → Carlito. Column widths in this format are stated in
  _characters_, so they depend on the default font's `maxDigitWidth` and drift
  between operating systems. Untested on three OSes.
- CSV: default to Windows-1251 for files from Russian/Ukrainian Excel. The
  wizard already offers it and shows the result; it does not guess it yet.
- A suite installer (one DMG, three apps) — Update 2 in the Slides plan.

### Open decisions

1. **Updater: one channel per app, or one for the suite?** Docs and Sheets each
   have their own endpoint in `tauri.conf.json`; the Slides plan has a recorded
   decision (2026-09-18) that the channel is shared across the suite and
   deferred to "Update 2 — suite distribution". All are `active: false`, so
   nothing ships either way, but three configs currently hold two intentions.

2. **Sheets memory.** ~200 bytes per cell is what puts the 1M-row budget on the
   line. Reducing it is not micro-optimisation, it is a question about how a
   cell is laid out in memory — numbers are currently stored as strings. Worth
   deciding before a workbook bigger than the budget arrives, not after.

3. **Whether to re-release Docs.** It is at the old `v0.1.0` tag from before the
   per-app tag scheme, and it has gained the shared chart engine since.

## What the tests do not cover, and it matters

Everything found by a person in the last week was about **what is on the
screen**, and none of it was visible to a suite that runs in jsdom, where a
canvas records nothing and every text measurement is zero:

- A real deck took the Slides window down: a layout effect worked a shape's
  height out from `outer.clientHeight - inner.clientHeight`, where `outer` is
  the shape — so the answer was a function of the height it was about to set.
  Measure, resize, measure again, until React gave up with "maximum update
  depth exceeded".
- The Sheets formula bar drew every cell that was not a formula **twice**: the
  coloured mirror behind the input was drawn always, while the input only went
  transparent for a formula. On screen it read as text struck through by itself.
- A window that stopped drawing said nothing at all — React unmounts the tree
  and the window goes to the background colour, which in this suite is black.
  There was no error boundary in any of the three apps.

All three are fixed and covered. The pattern is the finding: the automated
suite is strong on what a file _means_ and blind to what a window _shows_.
Playwright specs now exist for the parts that only a real engine can answer,
and they are the thing to extend when the next one of these turns up.

## How to check any of this

```sh
pnpm install
pnpm check                          # format, lint, typecheck, unit tests, everything
cargo test                          # the Rust side, including the formula engine
pnpm --filter <app> test:e2e        # Playwright, Chromium and WebKit
pnpm --filter <app> test:speed      # the timed benchmarks, by name
pnpm --filter <app> tauri dev       # run it
pnpm --filter <app> tauri build     # package it

ORANGERY_CORPUS=/path/to/real/files pnpm --filter slides test:e2e
```

Plans live in `apps/<app>/PLAN.md` (Ukrainian, with the reasoning for each
decision), rules in `apps/<app>/CLAUDE.md` and the root `CLAUDE.md`,
architecture decisions in `apps/<app>/docs/adr/`.

## If you are deciding what to do next

The honest summary: the code is further along than the evidence for it. Three
apps build on three platforms, two of them have shipped, 5,481 tests are green,
and nobody has opened the result and looked at it. The cheapest thing that
would change the most is a person, a real file and the checklist that is
already written.
