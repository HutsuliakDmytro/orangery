# Corpus baseline

What every corpus run answers today, 22 September 2026, on the corpus described
in `docs/corpus.md`. Nothing here has been fixed — the point of the first run is
to have a number to be better than, and the issues it produced are listed at the
bottom.

Reproduce with:

```
pnpm corpus:run                              # the public corpus
pnpm corpus:run --corpus ~/corpus-full       # everything openable
pnpm corpus:recalc                           # formulas, against the file's own answers
pnpm corpus:render --format docx|pptx|xlsx   # rendered before and after
pnpm --filter charts corpus                  # what the charts are
```

## Open → save → compare → open again

**The public corpus — 140 files, 15 MB, 14 seconds.**

| Format  |   Files |     ok |   diff | crash | timeout |   oom |
| ------- | ------: | -----: | -----: | ----: | ------: | ----: |
| docx    |      37 |     19 |     18 |     0 |       0 |     0 |
| pptx    |      42 | **42** |      0 |     0 |       0 |     0 |
| xlsx    |      61 |     19 |     42 |     0 |       0 |     0 |
| **all** | **140** | **80** | **60** | **0** |   **0** | **0** |

Of the 60 `diff`, 12 are differences every one of which a whitelist rule
forgives, and 48 have at least one difference nothing explains.

**Everything openable — 2,669 files, 68 seconds.**

| Format  |     Files |        ok |      diff |  crash | timeout |   oom |
| ------- | --------: | --------: | --------: | -----: | ------: | ----: |
| docx    |     1,461 |       677 |       759 |     25 |       0 |     0 |
| pptx    |       550 |       535 |         0 |     15 |       0 |     0 |
| xlsx    |       658 |       217 |       419 |     22 |       0 |     0 |
| **all** | **2,669** | **1,429** | **1,178** | **62** |   **0** | **0** |

Of the 62 `crash`, 56 are the `hostile/` pile — encrypted packages, POI's
fuzzer fixtures, LibreOffice's CVE samples — and failing to open them is the
right answer. All 75 hostile files are answered with a sentence naming what is
wrong, the slowest in 156 ms, and none takes the process down. The other six are
[#9](../../issues/9): files Word and Excel open and we do not.

No file anywhere took thirty seconds, and no file exhausted a gigabyte of heap.
Slides round-trips every deck in both corpora without a single structural
difference, which is what an eighteen-month-old preservation ADR is supposed to
buy.

### Why files differ, by how many files

Public corpus, counting each file once per cause:

| Files | Cause                                                                 | Issue                                                                   |
| ----: | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
|    20 | an element added or dropped (`child count differs`)                   | mostly [#6](../../issues/6), [#7](../../issues/7), [#8](../../issues/8) |
|    17 | `<cols>` loses `style` and `bestFit`                                  | [#3](../../issues/3)                                                    |
|    10 | namespace declarations dropped from a regenerated part                | [#5](../../issues/5)                                                    |
|     6 | the XML declaration rewritten (`utf-8` → `UTF-8`, `standalone` added) | —                                                                       |
|     3 | `w:history` dropped from a hyperlink                                  | [#8](../../issues/8)                                                    |
|     3 | text differs                                                          | under [#2](../../issues/2)                                              |
|     2 | run properties rebuilt                                                | [#7](../../issues/7)                                                    |
|     2 | `cfRule/@dxfId` renumbered                                            | [#17](../../issues/17)                                                  |
|     2 | cell `@s` renumbered                                                  | [#17](../../issues/17)                                                  |
|     2 | data validation prompts dropped                                       | [#4](../../issues/4)                                                    |

Full corpus, same counting:

| Files | Cause                                                  | Issue                  |
| ----: | ------------------------------------------------------ | ---------------------- |
|   507 | namespace declarations dropped from a regenerated part | [#5](../../issues/5)   |
|   259 | an element added or dropped                            | various                |
|   258 | `w:pgSz/@w:code` — the paper size — dropped            | [#16](../../issues/16) |
|   251 | `<cols>` loses `style` and `bestFit`                   | [#3](../../issues/3)   |
|    45 | the XML declaration rewritten                          | —                      |
|    34 | `w:background` dropped from the document               | [#16](../../issues/16) |
|    32 | `w:history` dropped from a hyperlink                   | [#8](../../issues/8)   |
|    18 | cell `@s` renumbered                                   | [#17](../../issues/17) |
|    14 | `xml:space="preserve"` taken off a run that had it     | [#16](../../issues/16) |
|    14 | run properties rebuilt                                 | [#7](../../issues/7)   |

The XML declaration row is the only one nobody has decided about: Slides keeps
the declaration a part arrived with (`declarationOf`), Docs and Sheets write
their own. It changes nothing a reader sees and it is a difference in every
regenerated part, so it is either a whitelist rule or a five-line fix, and the
run should not report it as an open question for much longer.

## Formulas

Every `<f>` loaded into `crates/formula`, recalculated, and compared against the
`<v>` its own writer cached beside it.

**Public corpus: 27 workbooks with formulas, 1,942 cells compared, 201 matched.**

That number is two workbooks:

| Workbook                             | Compared | Matched | Why                                                                                          |
| ------------------------------------ | -------: | ------: | -------------------------------------------------------------------------------------------- |
| `excel2007mac-charts-01.xlsx`        |    1,440 |       0 | every cell calls `RADIANS`, which is not implemented — [#11](../../issues/11)                |
| `excel2016win-arrayformulas-02.xlsx` |      266 |      18 | `MMULT`, `MINVERSE`, `MDETERM`, `TRANSPOSE` — [#11](../../issues/11), [#13](../../issues/13) |
| the other 25                         |      236 |     183 | 46 mismatches, listed in [#12](../../issues/12)–[#14](../../issues/14)                       |

Excluding those two workbooks the engine agrees with Excel about 78% of the
cells it is asked about; including them, 10%. Both numbers are worth keeping:
the first says how the arithmetic is doing, the second says what one missing
one-line function costs when somebody's workbook is built on it.

Seven mismatches are excused as the harness's fault rather than the engine's —
macros, spilled ranges, hidden rows — and `docs/corpus.md` says why. 18 formulas
would not parse at all; 15 were skipped as volatile or as reaching into another
workbook.

**Full corpus: see `corpus-recalc-full.json`.** 163 workbooks with formulas,
36,048 cells compared, 30,603 matched — 85%. The classes among the 5,349 that
are not are [#15](../../issues/15).

## Charts

80 charts in 19 files, read by `packages/charts`:

```
kinds:    bar 29, line 14, pie 10, scatter 9, unsupported 7, area 6, radar 5
framed:   Bubble 4, Sunburst 1, Stock 1, Box and whisker 1
features: number format 66, legend 37, title 25, manual layout 12, date axis 9,
          per-point colour 8, combination 1
not modelled: cs:chartStyle 55, c:view3D 17, c:extLst 15
```

`packages/charts/src/corpus.test.ts` now runs rather than skipping: every chart
parses, is not rewritten when nothing is edited, survives read-and-write
unchanged, and keeps its numbers when a legend is added. Three assertions across
three chart parts are skipped by name against [#10](../../issues/10).

`cs:chartStyle` in 55 of the 80 is the part `tests/fixtures/office/README.md`
asked for and no synthetic fixture had.

`pnpm corpus:charts` draws 73 of them to SVG and frames the other 7, into
`corpus-charts/index.html`. Nobody has been through that page against the
originals yet, and until somebody has, "the chart parses and round-trips" is
all any of these numbers claim.

## Rendered before and after

LibreOffice to PDF, rasterised at 100 dpi, compared pixel by pixel, 0.1%
threshold.

| Format | Files | Identical | Different |
| ------ | ----: | --------: | --------: |
| pptx   |    39 |    **39** |         0 |
| docx   |    34 |        30 |         4 |
| xlsx   |    57 |        50 |         7 |

Two of the four documents are conversion failures rather than pixel differences,
and one of those two is ours: LibreOffice converts `word2013win-cjk-01.docx` and
refuses the file we saved from it. The other is LibreOffice failing on the
original. Everything here is [#18](../../issues/18), with the individual causes
filed separately.

## What this baseline is for

It is the floor. A change that makes any number in it worse needs a reason
written down, and the first ten issues closed should move several of them at
once — [#5](../../issues/5) alone is 507 files.

**Not a CI gate yet.** `CORPUS.md` allows one only if it is green on the
baseline, and 60 of 140 public files differ. What is a gate today is the part
that _is_ green: `pnpm check` runs the charts corpus test and the Slides deck
corpus test over all 140 files, and both pass. When the `diff` count reaches
zero for a format, `pnpm corpus:run` on that format becomes the next gate.

## The issues this run produced

Round-trip and reading:

- [#2](../../issues/2) — xlsx: a self-closing `<c/>` swallows the cells after it _(the worst of them)_
- [#3](../../issues/3) — xlsx: a column loses `style` and `bestFit`
- [#4](../../issues/4) — xlsx: data validation loses its prompt and error message
- [#5](../../issues/5) — docx: a regenerated part loses its root namespace declarations
- [#6](../../issues/6) — docx: `w:tblPrEx` dropped, `w:gridSpan` changed
- [#7](../../issues/7) — docx: run properties collapse on a Word 2013 CJK document
- [#8](../../issues/8) — docx: `w:history` dropped, and an empty document gains a paragraph
- [#9](../../issues/9) — packages Word and Excel open and we do not
- [#10](../../issues/10) — charts: a legend edit that does not take, a chart with no series
- [#16](../../issues/16) — docx: paper size code, document background, `xml:space`
- [#17](../../issues/17) — xlsx: style indexes change on save
- [#18](../../issues/18) — the render baseline

Formulas:

- [#11](../../issues/11) — `RADIANS`, `MMULT`, `MINVERSE`, `MDETERM`, `GETPIVOTDATA` and others are missing
- [#12](../../issues/12) — `TEXT` and the `A/P` format codes
- [#13](../../issues/13) — array expressions in `SUM` and `COUNTIFS`, implicit intersection
- [#14](../../issues/14) — a circular reference comes out as `0`
- [#15](../../issues/15) — `SUBTOTAL`, `TRANSPOSE`, `SUMPRODUCT`, `INDEX`, `VLOOKUP` on the full corpus
