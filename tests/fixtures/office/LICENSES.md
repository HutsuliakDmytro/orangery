# Corpus sources and what may be committed

Written by hand from each project's own licence file, which sits next to this
one as `<source>/LICENSE`. The question every row answers is narrow: may a file
from this source be committed to a public repository, or must it stay outside
git and be reached through `ORANGERY_CORPUS`?

| Source | Where from | Licence | Public repo? | Notes |
| --- | --- | --- | --- | --- |
| `poi/` | `github.com/apache/poi`, `trunk`, sparse `test-data/{document,slideshow,spreadsheet,diagram}` | Apache-2.0 (`poi/LICENSE`, `poi/NOTICE`) | **Yes**, with attribution | AL-2.0 §4 wants the licence, the NOTICE text and a statement of changes. Files are unmodified, so a NOTICE line naming Apache POI is enough. |
| `python-docx/` | `github.com/python-openxml/python-docx`, sparse `tests/test_files` | MIT (`python-docx/LICENSE`) | **Yes**, with the copyright line | MIT needs the copyright notice and the permission notice kept with the files. |
| `python-pptx/` | `github.com/scanny/python-pptx`, sparse `tests/test_files` + `features/steps/test_files` | MIT (`python-pptx/LICENSE`) | **Yes**, with the copyright line | The `python-openxml` org no longer hosts python-pptx; `scanny/python-pptx` is the upstream the package is published from. |
| `libreoffice/` | `github.com/LibreOffice/core`, sparse `sw/qa/extras/ooxmlexport/data`, `sd/qa/unit/data/pptx`, `sc/qa/unit/data/xlsx` | MPL-2.0 (`libreoffice/LICENSE`) | **No** | MPL-2.0 is file-level copyleft: a committed copy would carry MPL obligations into an MIT repository. Kept out of git, reached through `ORANGERY_CORPUS`. Many of these files are also bug-report attachments whose provenance is a third party's, which is the second reason. |
| `sheetjs/` | `github.com/SheetJS/test_files` release snapshot | Apache-2.0 upstream | **Not downloaded** | The repository is blocked by GitHub ("Repository access blocked", TOS), through both the API and the releases page, and there is no mirror on `git.sheetjs.com`. See `docs/corpus.md` for what this leaves uncovered. |

## What that means in practice

- `tests/fixtures/office/` holds only Apache POI and python-docx/python-pptx
  files. Attribution for them is in `tests/fixtures/office/LICENSES.md`, which
  is the copy that ships with the repository.
- `~/corpus-full/` holds everything openable, LibreOffice included, and is
  never committed. `ORANGERY_CORPUS=~/corpus-full` points the corpus tests at it.
- Neither pile contains anything from a customer; `~/corpus-private/` does not
  exist on this machine.

## A caveat about POI test data

Much of `test-data` arrived as attachments to bug reports. Apache's CLA covers
contributions to the project and the ASF ships these files in its source
releases under AL-2.0, so redistributing them is on the same footing as
redistributing POI itself. Where a file looks like somebody's real business
document rather than a fixture, it was left out of the public selection even
though the licence would allow it — the selection prefers small, obviously
synthetic files, which is also what makes a failure legible.
