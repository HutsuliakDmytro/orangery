# Handoff — where this stands, 2026-09-20

Written so the next session can start working rather than start reading. It
says what exists, where it is, what state it is in, and what is waiting on
what. Everything here is checkable: if a claim and the code disagree, the code
is right and this file is stale.

## The one-paragraph version

Two phases of work: the shared chart engine (`packages/charts`, phase 0 of
`apps/sheets/PLAN.md`) and the spreadsheet itself (phase 1). Charts are read,
drawn, edited and inserted in Docs and Slides. The spreadsheet reads `.xlsx` —
cells, styles, colours, tables, comments, conditional formatting, drawings,
shared and array formulas, rich text — formats what it reads through
`packages/numfmt`, and shows all of it: values, bars, icon sets, wrapped and
rotated text, half-bold cells, charts and pictures over the grid, notes on
hover. It **saves**, and a file opened and saved untouched comes back with an
empty diff. And it can now be **selected in, typed into and undone**: a value
typed gets the type and the format it implies, the file grows the style entry
that needs, and a step is one thing somebody did however many cells it
touched, cut, copied, pasted, formatted from a toolbar, reshaped by putting
rows and columns in and out, hidden and resized — and every one of those can
be taken back. The toolbar does fonts, colours, alignment, borders, number
formats and merging, a table can be sorted and filtered, and a workbook can be
started from nothing, saved anywhere, and recovered after a crash. A `.csv`
comes in through a wizard that guesses out loud and goes out as what was on
screen. Since then: auto-fit on a double-clicked edge, Paste Special, a sort
dialog with custom orders, filters by condition, the fill handle, the tabs
along the bottom (add, duplicate, rename, move, hide, colour, delete), Find
and Replace, and freezing, zoom and gridlines. All of it is on the branch
`charts`, 51 commits; `main` has not moved, and the last thirty-three are not
pushed.

## Where the work is

- Branch `charts`. Merge with `git merge charts`, or open a pull request.
- Working tree clean apart from this file, which is deliberately untracked.

## What exists now

### Packages

| Package                                                                     | What it is                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ooxml-core`                                                                | The zip package, relationships, content types, XML. Unchanged except for use.                                                                                                                                                                                                                                                                                       |
| `ooxml-drawingml`                                                           | `a:*` shapes, text, colours, themes. Gained `dataUrlFrom` (moved out of Docs — showing a picture is the same question in every app).                                                                                                                                                                                                                                |
| `ooxml-presentation`                                                        | `p:*`. Unchanged this session.                                                                                                                                                                                                                                                                                                                                      |
| `charts`                                                                    | All of `c:*`: model, SVG renderer, edit operations, serialiser, templates, corpus harness. 216 tests.                                                                                                                                                                                                                                                               |
| **`ooxml-spreadsheet`**                                                     | Workbook, worksheet, streaming `sheetData`, styles with the `apply*` cascade, colours, tables, comments, conditional formatting (`conditional.ts` reads, `highlight.ts` judges), drawings (`drawing.ts`), shared and array formulas (`formulas.ts`), rich text (`rich-text.ts`), the serialiser (`save.ts`), **style deduplication** (`styles-edit.ts`). 231 tests. |
| `numfmt`                                                                    | Serial dates, format-code parser, formatter, the matrix of value-code-expected rows. 176 tests.                                                                                                                                                                                                                                                                     |
| **`grid`**                                                                  | The canvas grid: virtualised, styled cells, merges, frozen panes, keyboard editing, **zoom, wrapping, rotation, data bars, icon shapes, corner marks, an overlay layer**. 80 tests.                                                                                                                                                                                 |
| `ui-kit`, `platform`, `fonts`, `editor-text`, `render-diff`, `tauri-shared` | Unchanged.                                                                                                                                                                                                                                                                                                                                                          |

### Apps

- **Docs** — charts render, insert, restyle, and their numbers can be edited.
- **Slides** — chart data editor is the shared grid in a dialog; properties
  panel and five insert commands beside it.
- **Sheets** — opens a workbook (dialog, double-click, drop), shows it —
  styles, number formats, conditional formatting, charts, pictures, notes,
  zoom, sheet tabs — lets you select, type into a block, clear, fill, cut,
  copy, paste, format, insert and delete rows and columns, hide them, drag
  their edges, and undo, and saves it back atomically with a backup. No
  formula engine.

## Sheets, in detail

Read `apps/sheets/CLAUDE.md` for the rules and `apps/sheets/PLAN.md` for the
phases; the two ADRs are the decisions worth knowing before touching anything:

- `docs/adr/0001-charts-model.md` — one chart engine for three apps.
- `docs/adr/0002-xlsx-roundtrip.md` — three tiers: cells modelled and
  regenerated, small parts patched in place, somebody else's program never
  parsed.

```
apps/sheets/src/
  app/            the window, commands wiring, external open, shortcuts
  commands/       open, close, next/previous sheet
  document/       file.ts (paths in), workbook.ts (bytes to a model),
                  save.ts (a model back to bytes), edit.ts (typing into a cell),
                  history.ts (taking it back), clipboard.ts (cells in and out),
                  shown.ts (what a cell reads as),
                  structure.ts (rows and columns, hiding, merging),
                  sort.ts (putting a table in order),
                  filter.ts (the arrows, and what they hide),
                  new.ts (a workbook from nothing),
                  autosave.ts (a copy a crash cannot reach),
                  csv.ts (the format nobody specified),
                  csv-file.ts (a table in from, or out to, a text file),
                  series.ts (what comes after what), fill.ts (dragging a corner),
                  find.ts (finding it, and replacing it),
                  sheets.ts (the tabs, package and model together),
                  view.ts (freezing, zoom, gridlines)
  render/         …and toolbar.tsx, the strip of buttons above the grid,
                  csv-wizard.tsx, the questions a text file cannot answer,
                  sort-dialog.tsx, filter-menu.tsx, find-panel.tsx,
                  sheet-tabs.tsx
  render/         sheet-view.tsx      the seam between a workbook and the grid
                  sheet-drawings.tsx  charts and pictures over the canvas
                  sheet-notes.ts      comments, indexed by cell
                  note-box.tsx        the yellow box on hover
                  icon-sets.tsx       Excel's icon sets as grid shapes
  store/          workbook-store.ts
  test/           the 200k-cell workbook and the budgets
```

`sheet-view.tsx` is where to look first. It answers the grid one cell at a
time — shared strings, the style cascade, the theme, the format code, the
conditional rules — and caches the expensive halves.

### Seams worth knowing

- **A history step holds five kinds of change** (`document/history.ts`): a
  cell, the column runs, a row's properties, the merges, or the autofilter.
  Anything new that is not a cell change — a data validation, say — adds a
  sixth rather than finding a way to pretend it is a cell.
- **Two things deliberately stay out of the history.** Adding, deleting or
  renaming a sheet, as in Excel — a step able to give a deleted sheet back
  would have to hold a whole worksheet part — and the view (freezing, zoom,
  gridlines), because a view is where somebody is standing rather than what
  they have written. Both patch their part as they go, so the model and the
  bytes never disagree; deleting asks first instead of being undoable.
- **The worksheet is patched element by element** (`save.ts` and the
  `replace*` functions beside it): `sheetData`, then `<cols>`, then
  `<mergeCells>`. Anything else the app learns to edit inside a worksheet adds
  another `replaceX`, and each is left out for a sheet nobody touched so the
  bytes stay the bytes.

- **The grid knows shapes, not SpreadsheetML.** It draws an arrow and a
  circle; which of them `3TrafficLights1` amounts to is `icon-sets.ts`, in the
  app. Same for the corner mark: the grid draws a triangle in a colour and has
  no opinion about what it means.
- **Zoom is folded into the metrics**, not applied as a canvas transform, so
  hit-testing and scroll extents are measured in the units things are painted
  in. `zoomedMetrics` is exported for anything drawing over the grid.
- **The overlay is the grid's `overlay` prop**: the grid owns the scroll, so
  it says where the layer sits; the caller says what goes in it.

## What is blocked, and on what

1. **Real files from Office.** Three items of phase 0 and the whole corpus of
   phase 1 wait on ten to fifteen real `.xlsx`/`.pptx`/`.docx` files with
   charts and awkward formatting. Drop them in `tests/fixtures/office/` (see
   the README there) and `pnpm --filter charts corpus` reports what they hold.
   Blocked: `cs:chartStyle`, the render diff, the 300-row format matrix, the
   claim that Excel opens what we write, and the icon-set colours — which are
   read off the product today and want a diff against a real workbook.
2. **The formula engine (phase 3).** Conditional formatting is complete except
   for what needs one: `expression` rules, a `cellIs` whose operand is a
   reference, a `cfvo` of type `formula`. They are read and deliberately not
   judged.
3. **The Slides release.** `apps/slides/PLAN.md` phase 4 needs a beta, manual
   QA on hardware, signing, and somebody to decide to publish.

## What to do next

Phase 1 is done apart from what is blocked, and phase 2 has had most of its
list: selection, typing, the toolbar, undo, sorting, filtering, CSV,
auto-fit, Paste Special, the fill handle, sheet management, Find and Replace,
freezing and zoom. What is left, in the plan's order:

1. **Hyperlinks and comments** (`PLAN.md` line 95). Comments are read and
   shown already; writing one means `threadedComments` plus the legacy
   `comments` part Excel still expects beside it, and a `vmlDrawing` for
   where the yellow box sits.
2. **ODS**, the last unticked part of the files line. Import first: an `.ods`
   is a zip of flat XML with a table model close enough to read into the same
   cells, and far enough away (`table:number-columns-repeated`, its own style
   language, its own date syntax) that it wants a package of its own rather
   than a branch inside `ooxml-spreadsheet`. Export is the harder half and
   worth deciding separately: an `.ods` this app writes is a file whose round
   trip we have not promised.
3. **Format Cells** — the custom number-format dialog — and group/outline.
4. **Split panes and several windows**, the rest of the view line. A split is
   the same element with a different state, counted in twentieths of a point,
   and it wants the grid to learn a second kind of frozen edge.

Smaller ones for a short session: `Mod+;` and `Mod+Shift+;` for today's date
and time, `vmlDrawing` for where a note's yellow box actually sits, or the
column-autocomplete the plan asks for under cell editing.

## How to work here

- `pnpm check` at the root is the gate: format, lint, typecheck and tests for
  every package and app. Green before a commit.
- `cargo` is not on the default PATH; use
  `PATH="$HOME/.cargo/bin:$PATH" cargo check -p orangery-sheets`.
- Commits are scoped by package or app (`charts:`, `spreadsheet:`, `grid:`,
  `numfmt:`, `sheets:`, `docs:`, `slides:`) with a body saying what was decided
  and why, not what changed.
- Tests state what a person would notice. Where a case is unsettled it is left
  out rather than guessed: an invented expectation looks like evidence while
  being an opinion.
- `apps/sheets/tests/fixtures/xlsx/budget.xlsx` is built by hand and grown by
  hand. The first sheet is the plain one — values, formats, conditional rules,
  a chart, a picture, comments — and the second holds the awkward cases: 150 %
  zoom, a wrapped cell, a rotated one. Keep it that way; assertions about
  plain things belong on the plain sheet.

## Known rough edges

- **This machine, as of the 20th of September 2026, is thrashing**: 9.6 GB of
  11.3 GB swap in use, uptime 32 days, dozens of stale dev servers from other
  projects. It makes `pnpm check` unreliable in a way that looks exactly like
  a regression — vitest workers time out before they start, and one arbitrary
  test of `apps/docs/src/ooxml/roundtrip.test.ts` exceeds its 30 s budget. It
  is a different test every run, and the whole file passes 81/81 in twenty
  seconds when run alone. `packages/ooxml-presentation` does the same thing —
  seven files, one timeout each, 764 s per file, and 743/743 in eight seconds
  alone. Worse, `apps/slides` reported 60, then 56, then 59 test files on
  three consecutive runs of the same code: under this much pressure vitest
  silently under-reports rather than failing, so a green full run means less
  than it looks. Check the swap before believing either colour, and verify a
  package by running it on its own:
  `node node_modules/vitest/vitest.mjs run` from inside it, which also skips
  the two-minute corepack network probe that `pnpm` stalls on
  (`COREPACK_ENABLE_NETWORK=0` skips that too).
- `apps/docs/src/test/performance.test.ts` measures wall-clock ratios while
  the whole workspace runs its tests. Allowed two retries; a single failure in
  a full run that passes alone is what it is, not a regression.
- The `editor-text` unhandled error is fixed: the tests' editors were never
  destroyed, so ProseMirror work scheduled on a jsdom document landed after
  the environment had gone.
- The grid draws borders per cell, so a shared edge is drawn twice. That is
  what the format describes.
- Sheets renders a split pane as an ordinary sheet: only frozen panes are held.
- Drawings scroll with the sheet even when anchored inside a frozen pane, and
  everything in the overlay is above everything on the canvas. Both are
  simplifications, written down where they are made.
- A `dxf` fill beats a colour scale on the same cell. Strictly it should be
  whichever rule has the lower priority number; the simpler rule is right
  whenever the stated colour came from the newer rule, which is where Excel
  puts one.
