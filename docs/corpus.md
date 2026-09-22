# The corpus

`tests/fixtures/office/` is a hundred and forty documents that other programs
wrote. Everything else in the repository's fixtures is synthetic — built by a
script, holding exactly what the test that reads it needs — which is the right
shape for asking "does this element parse" and the wrong shape for asking "does
a file somebody actually has survive being opened and saved". This is the
second question, and `CORPUS.md` is the plan it came from.

## Where the files came from

Downloaded into `~/corpus-raw/<source>/`, each with its licence beside it in
`~/corpus-raw/LICENSES.md` — the copy that ships with the public selection is
`tests/fixtures/office/LICENSES.md`.

| Source                                  | What was taken                                                                  | Licence    | In git?            |
| --------------------------------------- | ------------------------------------------------------------------------------- | ---------- | ------------------ |
| `github.com/apache/poi`, `trunk`        | `test-data/{document,slideshow,spreadsheet,diagram}`                            | Apache-2.0 | yes                |
| `github.com/python-openxml/python-docx` | `tests/test_files`                                                              | MIT        | yes                |
| `github.com/scanny/python-pptx`         | `tests/test_files`, `features/steps/test_files`                                 | MIT        | yes                |
| `github.com/LibreOffice/core`           | `sw/qa/extras/ooxmlexport/data`, `sd/qa/unit/data/pptx`, `sc/qa/unit/data/xlsx` | MPL-2.0    | **no**             |
| `github.com/SheetJS/test_files`         | —                                                                               | Apache-2.0 | **not downloaded** |

Two notes on that table.

**LibreOffice is not committed.** MPL-2.0 is file-level copyleft and this is an
MIT repository; a committed copy would carry obligations into it. Those 2,124
files are two thirds of the corpus and they are reached through
`ORANGERY_CORPUS` instead. They are also the more interesting two thirds — a
`sw/qa` file is usually the minimal reproduction of a bug somebody found in
Word's output, which is exactly the kind of file that breaks a reader.

**SheetJS could not be downloaded at all.** `github.com/SheetJS/test_files`
answers _Repository access blocked_ (a GitHub TOS block dated 2024-07-19) to the
API and to the releases page alike, and `git.sheetjs.com`, where SheetJS keeps
its other repositories, has no mirror of it. What that costs us is mostly
number formats: the `numfmt_*` workbooks `CORPUS.md` names as mandatory are the
densest fixtures for that anywhere, and the snapshot also carried openpyxl's
and Gnumeric's own test files, which are writers nothing else here represents.
The gap is worth filling from another direction — openpyxl's test files live on
`foss.heptapod.net` under Mercurial, which is a separate piece of work.

`python-openxml` no longer hosts python-pptx; `scanny/python-pptx` is the
upstream the package is published from, and that is what was cloned.

`~/corpus-private/` does not exist on this machine, so nothing in any of this
came from a customer.

## How it is laid out

```
tests/fixtures/office/         140 files, 15 MB — in git
  docx/  pptx/  xlsx/          named <generator>-<feature>-<n>.<ext>
  manifest.json                where each one came from, and why it was picked
  LICENSES.md
~/corpus-raw/                   the four clones, untouched
~/corpus-full/                  3,770 files — never in git
  docx/ pptx/ xlsx/             everything openable that is not in the public corpus
  legacy/                       .doc, .xls, .ppt, ODF, Visio — a different reader one day
  hostile/                      encrypted, or broken on purpose
```

`~/corpus-full` is hard links into `~/corpus-raw`, so it costs no disk. Rebuild
either with `pnpm corpus:inventory && pnpm corpus:select`.

The public names say what a file is for: `excel2016win-pivot-01.xlsx` is a
pivot table written by Excel 2016 for Windows. The generator comes from
`docProps/app.xml`, so `libreoffice-numbering-01.docx` is a file LibreOffice
wrote that lives in Apache POI's test data — the licence follows the source,
the name follows the writer, and `manifest.json` has both.

### How the hundred and forty were picked

A matrix of feature against generator, from `CORPUS.md` step 2: two files to a
cell, from as many different writers as the cell has, smallest first. Charts
and formulas get more, because three plan items are blocked on them — 80 charts
in 19 files, 27 workbooks with formulas. What was left of the budget went to
whichever files carried the most features that were still thin.

Four cells are empty, and all four for the same reason: `docx/toc`,
`docx/math`, `docx/smartart` and `xlsx/dynamicarrays` exist in the corpus only
in LibreOffice's data, which cannot be committed. They are covered by
`ORANGERY_CORPUS` runs and nowhere else.

A `.pptx` with no slides in it — POI has two — is a legitimate package and is
kept out of the public selection, because the deck tests are written around a
deck having slides.

## What runs against it

| Command                                        | What it asks                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm corpus:inventory`                        | what is in `~/corpus-raw`: format, generator, parts, features              |
| `pnpm corpus:select`                           | the public selection and `~/corpus-full`, rebuilt from the inventory       |
| `pnpm corpus:run`                              | open → save → structural diff → open again, per file, `corpus-report.json` |
| `pnpm corpus:recalc`                           | every `<f>` recalculated and compared against the `<v>` beside it          |
| `pnpm corpus:render --format docx\|pptx\|xlsx` | rendered to PDF before and after, compared pixel by pixel                  |
| `pnpm --filter charts corpus`                  | what the charts in it are, and what nothing models yet                     |
| `pnpm --filter charts test:unit`               | every chart parses, round-trips, and survives an edit                      |
| `pnpm --filter slides test:unit`               | every deck opens **and draws**, through the component the window uses      |

Point any of them at the full corpus with `--corpus ~/corpus-full`, and the two
test suites with `ORANGERY_CORPUS=~/corpus-full`.

The numbers each of them gives today are in `docs/corpus-baseline.md`.

### What the round-trip run does, precisely

For each file: read the package; open it the way the app that owns it opens it;
save it with **no edit**, forcing the serialiser to run over every part it owns
rather than passing the bytes through; read the saved package; compare part by
part; then open the saved file again.

Saving is made to regenerate on purpose. An untouched save writes most parts
back from the buffers they were read into, which would compare equal without
having tested anything — the serialiser is the thing under test. For Sheets
that means `workbookBytes(open, { edited: true })`, for Slides
`rewriteEveryPart`, for Docs `saveDocx(open, open.doc)`.

Each file gets `ok`, `diff`, `crash`, `timeout` or `oom`. The work happens in
child processes, fifty files each, because a file that hangs has to be timed out
by something outside the process doing the work, and a file that exhausts the
heap kills that process rather than throwing. Thirty seconds and a gigabyte
each, both settable.

### What counts as a difference

`compareXml` already ignores what Word itself varies between saves of an
untouched file: `w:rsid*`, attribute order, empty property containers. Three
more normalisations happen in `scripts/corpus/normalise.ts` before the
comparison, and each exists because without it one fact reports as a hundred
differences:

- **Indentation.** LibreOffice pretty-prints; we do not. Whitespace-only text
  is dropped from any element that also has element children — the XML notion
  of ignorable whitespace, which cannot touch `w:t` or `a:t` because those hold
  text and no elements.
- **Elements both writers regenerate.** `w:proofErr` is where the spell-checker
  stopped and `w:lastRenderedPageBreak` is where somebody else's layout engine
  broke a page. Dropping them is a decision; leaving them in the comparison
  makes every later sibling of a dropped one report as a mismatch.
- **Manifest entries for parts that came or went.** `[Content_Types].xml` and
  the `.rels` files are sets, not sequences, so they are compared unordered, and
  an entry pointing at a part that is not in both packages is dropped from both
  sides. Otherwise one removed part — `xl/calcChain.xml`, which a workbook that
  was edited no longer has — becomes sixty differences.

What survives that is sorted by `scripts/corpus/whitelist.ts` into _forgiven_,
with a rule that says why, and _unexplained_, which is what the issues are
about. The forgiven list today: the dropped `calcChain`, `w:proofErr`,
`w:lastRenderedPageBreak`, `xml:space="preserve"` added to a `w:t` that did not
have it, `1` against `true` in a boolean attribute, and attributes written with
the value the schema already defaults to.

### What the recalculation run does

`crates/formula` is a Rust library with no idea what a file is, and these
scripts are TypeScript that cannot call it. `crates/formula/examples/corpus-recalc.rs`
is the seam: cells in on stdin, values out on stdout, one tab-separated record
a line. It is an example rather than a binary so that nothing ships it and the
crate keeps its zero dependencies.

Build it once with `cargo build --release -p formula --example corpus-recalc`.

Three kinds of disagreement are excused rather than counted, because they are
the harness's doing and not the engine's: a function defined in a workbook's
macros (`#NAME?` and always will be), a dynamic array whose spill range is
filled with the answers the file cached (`#SPILL!`, caused by loading them),
and `SUBTOTAL(1xx)` or `AGGREGATE`, which leave out rows a filter has hidden —
the app tells the engine which rows those are and this harness does not.

Known limitations worth fixing before the numbers are quoted anywhere else: the
engine has one namespace for defined names, so a name local to one sheet is sent
as a workbook one; and a workbook that links to another file is compared against
answers that came from a file we do not have.

## The piles that are not the corpus

`legacy/` is `.doc`, `.xls`, `.ppt`, ODF and Visio: 1,101 files for a reader
that does not exist yet. The round-trip run skips them by extension — asking an
OOXML reader to open a `.doc` tells you only that it is not a zip.

`hostile/` is 75 files that are not meant to open: encrypted packages, POI's
`clusterfuzz-testcase-minimized-*` fixtures, LibreOffice's CVE samples. They are
run anyway, and the answer is the one wanted: 54 of them fail to open with a
sentence naming what is wrong, the slowest in 4 ms, and none of them take the
process down. Nineteen open despite their names, which is fine — a file called
`bad_*` that is merely unusual is still a file.

Two files of that kind are in the valid pile because nothing about their names
says otherwise, and both are worth knowing about: POI's `deep-table-cell.docx`
is answered with _Maximum nested tags exceeded_ and `ExternalEntityInText.docx`
with _External entities are not supported_. Both are the parser refusing an
attack, quickly and in words.
