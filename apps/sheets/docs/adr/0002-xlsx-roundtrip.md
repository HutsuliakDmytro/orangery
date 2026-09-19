# 0002 — XLSX round-trip: the sheet is modelled, everything else is kept

- Status: accepted
- Date: 2026-09-19

## Context

XLSX is the native format, and the guarantee is the one the other two apps
already make: open a workbook, save it without edits, and Excel is given back
what it gave us. Both of them got there by keeping the package as read and
regenerating as little as possible — Docs rewrites only `word/document.xml`
and keeps unmodelled elements inside it as opaque blocks
(`apps/docs/docs/adr/0003`); Slides does not even regenerate a shape, it
patches the subtree the shape was parsed from (`apps/slides/docs/adr/0002`).

Neither recipe transfers whole, for a reason that is about size rather than
taste.

**A worksheet is not a document, it is a table with a million rows.** Slides
can hold every shape's original XML because a deck has a few hundred shapes. A
sheet has ten million cells, and the plan says a 500k-row file must not build a
DOM at all: the parser is streaming, so there is no subtree per cell to patch
and nowhere to keep one. The parts of a workbook that are small — the workbook
itself, the styles, the tables, the comments — are a different problem from the
part that is enormous, and one rule for both is a rule that is wrong for one of
them.

There is a second pressure the other apps do not have. A workbook is the file
format of a _program_: pivot caches, query tables, external connections, data
models, macros. Excel's own features write parts nothing here will model this
decade, and a spreadsheet that loses somebody's pivot table on save is not a
spreadsheet anybody can use.

## Decision

**Three tiers, decided by what a part is, not by how it is spelled.**

### 1. The cells are modelled and regenerated

`sheetData` is read into a sparse model and written out from it. Not patched:
patching needs a tree, a tree needs a DOM, and a DOM of a million cells is the
thing the streaming parser exists to avoid. Writing is a stream too — rows in
order, cells in column order — which is also the only way a save of a large
sheet stays a second rather than a minute.

What a cell carries comes with it, modelled or not:

- modelled: the reference, the type, the style index, the value, the formula
  with its shape (`shared`, `array`, `dataTable`) and its cached result;
- carried: `cm`, `vm` and `ph` — cell metadata, value metadata, phonetic
  guides. Nothing here knows what they mean; a cell that dropped them would
  lose a dynamic array's identity or a Japanese reading, so they ride along as
  attributes and go back out where they came from.

A row is the same: the modelled properties (height, custom height, outline
level, hidden, style) and the attributes we do not know, kept per row.

### 2. The small parts of a sheet are patched in place

Everything else inside `worksheet` — `sheetViews`, `cols`, `mergeCells`,
`conditionalFormatting`, `dataValidations`, `hyperlinks`, `autoFilter`,
`pageSetup`, the drawing and legacy-drawing relationships, and the dozen
elements we have never heard of — is kept as it was and written back in schema
order, with only the elements we model rewritten. This is Slides' rule applied
to the part of a worksheet that is small enough for it.

**Order is part of the format here as much as anywhere else.** `worksheet`
wants `sheetPr`, `dimension`, `sheetViews`, `sheetFormatPr`, `cols`,
`sheetData`, `sheetCalcPr`, `sheetProtection`, … and Excel offers to repair a
file that says otherwise.

### 3. The parts that are somebody else's program are never touched

Read as bytes, written as bytes, never parsed:

| Part                                   | Why                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `pivotCache*`, `pivotTable*`           | A pivot is a program with a cached result; editing one means implementing it |
| `slicers`, `timelines`                 | They point at pivots                                                         |
| `queryTables`, `connections`, `model`  | Power Query and the data model — a language of their own                     |
| `vbaProject.bin`                       | Macros are kept and never run (`PLAN.md`, out of scope)                      |
| `customXml`, `customProperty`          | Somebody's schema, usually a line-of-business system's                       |
| `externalLinks`                        | A reference to a file we do not have; the cached values are what gets drawn  |
| `metadata`, `richData`, `rdrichvalue*` | Dynamic arrays and rich values, which Excel 365 writes and reads             |
| `printerSettings`                      | Binary, per-machine, and meaningless to change                               |
| `ctrlProps`, `activeX`                 | Embedded controls                                                            |

A workbook that holds any of these opens, draws its numbers, saves, and opens
in Excel with all of it working. That is the whole of the promise for MVP: we
are not the program those parts belong to.

## The three parts that need a rule of their own

**`sharedStrings.xml` is appended to, never rebuilt.** Every string cell is an
index into it, so rebuilding the table renumbers every one of them and turns a
one-cell edit into a whole-file diff. New strings go on the end and `count` and
`uniqueCount` follow; strings that stop being used stay, exactly as Excel
leaves them until it rewrites the file itself.

**`calcChain.xml` is deleted when a formula changed, and kept otherwise.** It
is a cache of evaluation order, Excel rebuilds it without complaint, and a
stale one is a file Excel offers to repair. Deleting it means dropping its
relationship and its content-type override too, or the repair happens for the
other reason.

**`styles.xml` is deduplicated into `cellXfs`, never extended per cell.** A
sheet where every cell has its own `xf` is one Excel opens slowly and every
other reader opens wrongly; the model holds a style index and the writer gives
equal styles the same one.

## Consequences

- The reader has two shapes — streaming for `sheetData`, a tree for everything
  else — and the seam between them is where bugs will live. It is worth one
  test per part that a file with that part in it round-trips byte for byte.
- A cell's unmodelled attributes are carried in the model, so the model is
  wider than what the app displays. That is the price of not losing a dynamic
  array's `cm` on the first save.
- Regenerating `sheetData` means the diff of a saved file is larger than
  Slides' — every row is rewritten even if one cell changed. Structurally it is
  identical, which is what the round-trip test compares; byte-identity is not
  promised for the sheet, and is for every other part.
- **The quiet failure is a carried attribute nobody carries.** An element we
  model but whose writer forgets one of its attributes fails silently: the file
  opens, and something invisible is gone. Every modelled element needs a test
  that reads a real file, writes it back and compares, rather than a test that
  builds the element by hand and reads it again.
- Corpus first, features second. Thirty real workbooks — Excel for Mac and
  Windows, Google Sheets, LibreOffice, one with a pivot, one with macros, one
  with an external link — are what turns any of this from an intention into a
  measurement.
