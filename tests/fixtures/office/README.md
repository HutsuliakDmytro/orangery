# Real files from Office

Everything in `apps/*/tests/fixtures` is synthetic: built by a script, holding
exactly what the test that reads it needs. That is the right shape for asking
"does this element parse", and the wrong shape for asking "does a file people
actually have round-trip". The two questions need different files.

This directory is for the second kind: documents saved by the programs we have
to be compatible with. Nothing generates them, and nothing here is committed
unless it can be — drop files in, and the corpus tests pick them up.

## What is here

140 files, 15 MB, in `docx/`, `pptx/` and `xlsx/`: Apache POI's and
python-docx/python-pptx's test data, picked to cover a matrix of feature against
generator — 24 different writers, from Word 2007 to Excel for Mac 2016 to
OnlyOffice. `manifest.json` says where each one came from and which feature it
was picked for; `LICENSES.md` says why each may be committed.

`docs/corpus.md` is how they were chosen and what runs against them.
`docs/corpus-baseline.md` is what those runs say today.

The name of a file says what it is for: `excel2016win-pivot-01.xlsx` is a pivot
table written by Excel 2016 for Windows. The writer comes from
`docProps/app.xml`, so a file POI keeps that LibreOffice wrote is called
`libreoffice-…` — the licence follows where it came from, the name follows who
wrote it.

Three times as many files again are kept outside git, in `~/corpus-full`,
because LibreOffice's test data is MPL-2.0 and this repository is MIT. Set
`ORANGERY_CORPUS` to point any of the tests below at it.

## What is still wanted

Charts were what was blocked (`apps/sheets/PLAN.md`, phase 0), and the selection
now holds 80 of them in 19 files — including `cs:chartStyle` in 55, which no
synthetic fixture had. The table below is what a corpus of real files should
cover; the columns nothing fills are Google's and Apple's writers, which are not
in any of the projects it was built from:

| Source | Why it matters |
| --- | --- |
| PowerPoint for Mac and for Windows | `cs:chartStyle` parts, which no synthetic fixture has |
| Excel for Mac and for Windows | charts that point at a sheet rather than an embedded workbook |
| Word, a document with a chart | the `w:drawing` path, anchored as well as inline |
| Google Slides / Sheets export | a second writer's idea of the same format |
| LibreOffice Impress / Calc | a third, and the one CI can render against |
| Anything with a chart we frame rather than draw | waterfall, treemap, sunburst, stock, surface |

Ten to fifteen files is enough to be useful. Twenty covering the table above is
better than a hundred from one program.

## What happens to them

`packages/charts/src/corpus.test.ts` reads every `.pptx`, `.docx` and `.xlsx`
here, finds the chart parts inside, and asks of each one:

- it parses, and says which kind it is or names itself as one we do not draw;
- reading and writing it back changes nothing — the test of the guarantee that
  a chart carries back what we do not model;
- an edit to one thing changes one thing.

With the directory empty the test says so and skips, which is why it can live
in the repository before the files do.

`apps/slides/src/test/corpus.test.tsx` takes every `.pptx` here and **draws**
it — every slide, through the same component the window uses. That is a
different question from whether it parses, and it is the one that was not being
asked: opening somebody else's presentation once took the whole window down,
because a render threw where no file we had written could make it throw.

`pnpm --filter charts corpus` prints what a corpus holds — kinds, features,
the parts nobody models yet — which is how to decide what to implement next
rather than guessing.

## Licensing

Only put files here that can be committed: your own, or something you have the
right to redistribute. A file from a customer belongs in a private corpus, and
the tests read a path from `ORANGERY_CORPUS` when one is set, so a private
directory works without copying anything into the repository.
