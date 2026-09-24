# CLAUDE.md — Orangery Sheets (+ `packages/charts`)

Desktop spreadsheet (Excel / Google Sheets analogue), third app in the Orangery monorepo. Also owns the shared `packages/charts` engine used by Docs, Slides and Sheets. macOS first, Windows + Linux in the first post-MVP update.
Product name: **Orangery Sheets**. Bundle id `com.orangery.sheets`, binary `orangery-sheets`. Read `PLAN.md` here; workspace rules in the root `CLAUDE.md`.

## Product principles

- **Familiar.** Layout = Excel/Google Sheets: formula bar, column/row headers, sheet tabs bottom, toolbar top. Shortcuts as Excel. When unsure, do what Google Sheets does.
- **XLSX is the native format.** No proprietary format. Round-trip preservation is a hard requirement: pivots, macros (`vbaProject.bin`), external links, Power Query parts, slicers, sparklines — kept verbatim if not modelled.
- **Numbers must be right.** A formula result that differs from Excel is a bug of the highest severity. Test against Excel-computed expected values, not against our own engine.
- **Big sheets stay smooth.** 1M rows × 100 cols must scroll at 60 fps; recalculation is incremental.

## Tech stack (fixed)

| Layer | Choice |
|---|---|
| Shell / UI / platform | Tauri 2, React 19 + TS, `packages/ui-kit`, `packages/platform`, `packages/tauri-shared` — same as Docs/Slides |
| Grid | **`<canvas>` rendering** (unlike Slides), in `packages/grid` — shared with the chart data editor. Cells are drawn, not DOM; a single overlaid `<input>`/contenteditable for the editing cell. Virtualized in both axes. This is the only app where canvas is the right call — a million DOM cells is not an option. |
| Cell model | Sparse: `Map<sheetId, Map<rowIdx, Map<colIdx, Cell>>>` + row/col metadata; column-major style indexes as in `styles.xml` (`cellXfs`) |
| Formula engine | **Own, in Rust** (`crates/formula`), exposed via Tauri commands + a WASM build for the web viewer. Parser → AST → dependency graph → incremental recalc. No third-party engine (HyperFormula is GPL/commercial, and JS is too slow for large recalcs). |
| XLSX engine | `packages/ooxml-spreadsheet` on `ooxml-core`: workbook, sheets, sharedStrings, styles, theme, definedNames, tables, calcChain, drawings, comments/threadedComments, vml, pivots/slicers/queries as passthrough |
| Charts | `packages/charts`: full `c:*` parser, SVG renderer, edit model, XML regeneration preserving unmodelled style; consumed by all three apps |
| Number formats | Own implementation of Excel format codes (`numFmt`) in TS with a shared test table; the Rust engine only computes values, formatting is UI |
| Other formats | CSV/TSV (import wizard: delimiter, encoding, locale decimal), ODS import/export, `.xls` (BIFF8) read-only post-MVP |
| Tests | Vitest, `cargo test`, Playwright; formula corpus with Excel-computed expected values; round-trip corpus + LibreOffice render-diff |

## Design system

Same tokens. Grid itself: white cells, grey `#DADADA` gridlines, selection border and fill handle orange, active sheet tab orange underline. Dark app theme does not darken the grid unless the user enables "dark sheet" (post-MVP).

## Model rules

- Cell = `{ value, formula?, styleIdx, type: n|s|b|e|d|str|inlineStr, cachedValue }`. On save we write both `<f>` and the cached `<v>` like Excel does, so other apps show numbers without recalculating.
- On open: trust cached values until the first edit triggers recalculation of the dependency graph (or the user hits Recalculate). `fullCalcOnLoad` respected.
- Dates are serial numbers; the workbook's date system (`date1904`) is honored everywhere. Never store JS `Date` in cells.
- Number precision follows Excel: 15 significant digits displayed, IEEE 754 doubles internally, Excel's "close to zero" rounding rules for subtraction (see `docs/adr/0004-precision.md`).
- Styles are deduplicated into `cellXfs` on save exactly as Excel does; never write one `xf` per cell.
- Shared formulas (`t="shared"`) and array formulas (`t="array"`) are expanded in the model and re-collapsed on save when unchanged.
- Dynamic arrays (spill, `_xlfn.` prefixes, `cm="1"` metadata) supported in engine and written the Excel 365 way.

## Formula engine rules

- A1 references only in MVP (R1C1 display option post-MVP). Relative/absolute, ranges, whole rows/cols, 3D `Sheet1:Sheet3!A1`, structured table refs `Table1[Col]`, named ranges, external refs `[Book.xlsx]Sheet!A1` — external are passthrough (keep cached value, mark `#REF`-safe).
- Functions live in a registry `crates/formula/src/functions/<category>.rs` with `{ name, min_args, max_args, volatile, implementation }`. Each function has ≥ 5 test cases with Excel-verified results. No function is "done" without them.
- Error values: `#DIV/0!`, `#N/A`, `#NAME?`, `#NULL!`, `#NUM!`, `#REF!`, `#VALUE!`, `#SPILL!`, `#CALC!` — propagate as Excel does.
- Recalc: topological on the dirty subgraph; volatile functions (`NOW`, `RAND`, `OFFSET`, `INDIRECT`) recomputed each cycle; circular refs detected and reported (iterative calc post-MVP).
- Engine is pure: no I/O, no UI knowledge. Locale affects only parsing of user input (`;` vs `,`) and display, never the stored formula (always stored in en-US canonical form as in the file).

## Grid / editor rules

- All commands in the shared registry. Keyboard: Excel parity (`F2`, `Mod+Enter`, `Shift+Space`, `Mod+Space`, `Mod+Shift+Arrows`, `Mod+D/R`, `Alt+Enter` in cell).
- Rendering budget: a full viewport repaint < 8 ms; only dirty rectangles on edit; text measured with cached font metrics.
- Undo/redo transactional per workbook; a paste of 100k cells is one undo step.
- Fill handle: series detection (numbers, dates, weekdays, months, custom lists), formula copy with reference adjustment.
- Clipboard: internal format (styles + formulas), HTML (for Docs/Slides/browsers), TSV plain.

## `packages/charts` rules

- One model for all three apps: `Chart { type, series[], categories, axes, legend, title, style refs }` plus the original `c:chartSpace` XML kept per chart.
- On save, rewrite only the elements we model; unknown `c:*` children preserved in place.
- Renderer is SVG, theme-aware (`schemeClr`), matches PowerPoint/Excel defaults for gaps, overlap, marker sizes.
- Data source: an inline table (Docs/Slides embed a mini workbook `embeddings/*.xlsx` — we read/write it via `ooxml-spreadsheet`) or a sheet range (Sheets). The chart data editor is a small grid built from the Sheets grid component.

## File rules

Atomic write, `.bak`, autosave snapshots, crash recovery from `tauri-shared`. Works offline. No telemetry.

## Coding conventions

Same as Docs/Slides. Commit scopes: `sheets`, `spreadsheet` (ooxml pkg), `formula` (Rust crate), `charts`, `numfmt`.

## Workflow for Claude Code

1. `PLAN.md` here, first unchecked task in the current phase. Phase 0 (charts) is shared infrastructure and must keep Docs and Slides green.
2. Non-trivial → plan in chat; architecture → ADR in `apps/sheets/docs/adr/`.
3. `pnpm check` at root; `cargo test -p formula`; e2e when relevant.
4. Formula work: add the Excel-verified expected values first, then implement.
5. Tick, summarize, next.

```
pnpm --filter sheets tauri dev
cargo test -p formula
pnpm --filter charts test
```

## Out of scope for MVP

Pivot table editing (render passthrough as static values), macros/VBA execution, Power Query, slicers, sparklines editing, iterative calc, R1C1, collaboration, cloud, Excel add-ins.

## Known hard problems

- **Number format codes** — Excel's `numFmt` mini-language (sections, conditions, colors, locale tokens, `[$-409]`, fractions, elapsed time) is large; build from a spec table with a test matrix, not ad hoc.
- **Function fidelity** — 500+ functions in Excel; MVP ships ~250 with verified tests. `TEXT`, `DATE*`, financial and statistical functions are where results silently diverge.
- **Precision** — Excel is not IEEE-pure (`=0.1+0.2-0.3` shows 0). Document and replicate the specific rules.
- **Performance** — recalc graph on 1M cells, canvas with merged cells and wrapped text, conditional formatting evaluated per visible cell only.
- **Charts** — `c:*` is huge (30+ chart types with variants); model the 8 common types fully, preserve the rest.
