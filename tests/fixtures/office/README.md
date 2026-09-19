# Real files from Office

Everything in `apps/*/tests/fixtures` is synthetic: built by a script, holding
exactly what the test that reads it needs. That is the right shape for asking
"does this element parse", and the wrong shape for asking "does a file people
actually have round-trip". The two questions need different files.

This directory is for the second kind: documents saved by the programs we have
to be compatible with. Nothing generates them, and nothing here is committed
unless it can be — drop files in, and the corpus tests pick them up.

## What is wanted

Charts first, because that is what is blocked on them (`apps/sheets/PLAN.md`,
phase 0):

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

`pnpm --filter charts corpus` prints what a corpus holds — kinds, features,
the parts nobody models yet — which is how to decide what to implement next
rather than guessing.

## Licensing

Only put files here that can be committed: your own, or something you have the
right to redistribute. A file from a customer belongs in a private corpus, and
the tests read a path from `ORANGERY_CORPUS` when one is set, so a private
directory works without copying anything into the repository.
