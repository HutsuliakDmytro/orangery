# Corpus baseline

What every corpus run answers, on the corpus described in `docs/corpus.md`. The
first run was 22 September 2026 and fixed nothing: the point of it was to have
a number to be better than. Every number below is the current one, and
[what has moved](#what-has-moved) says which fix moved it.

The rule the baseline exists for: **no number here may get worse**. A change
that makes one worse needs the reason written down beside it.

Reproduce with:

```
pnpm corpus:run                              # the public corpus
pnpm corpus:run --corpus ~/corpus-full       # everything openable
pnpm corpus:recalc                           # formulas, against the file's own answers
pnpm corpus:render --format docx|pptx|xlsx   # rendered before and after
pnpm --filter charts corpus                  # what the charts are
```

## Open → save → compare → open again

**The public corpus — 140 files, 15 MB, 15 seconds.**

| Format  |   Files |     ok |   diff | crash | timeout |   oom |
| ------- | ------: | -----: | -----: | ----: | ------: | ----: |
| docx    |      37 |     24 |     13 |     0 |       0 |     0 |
| pptx    |      42 | **42** |      0 |     0 |       0 |     0 |
| xlsx    |      61 |     21 |     40 |     0 |       0 |     0 |
| **all** | **140** | **87** | **53** | **0** |   **0** | **0** |

**Everything openable — 2,669 files, 77 seconds.**

| Format  |     Files |        ok |    diff |  crash | timeout |   oom |
| ------- | --------: | --------: | ------: | -----: | ------: | ----: |
| docx    |     1,461 |     1,051 |     386 |     24 |       0 |     0 |
| pptx    |       550 |       535 |       0 |     15 |       0 |     0 |
| xlsx    |       658 |       324 |     315 |     19 |       0 |     0 |
| **all** | **2,669** | **1,910** | **701** | **58** |   **0** | **0** |

Of the 58 `crash`, 54 are the `hostile/` pile — encrypted packages, POI's
fuzzer fixtures, LibreOffice's CVE samples — and failing to open them is the
right answer. Every one of the 58, hostile or not, is an `OoxmlFormatError`
with a sentence naming what is wrong: a file that is not a zip, a package whose
entry will not inflate, an OpenDocument file wearing a `.docx` name, XML built
to exhaust a reader. None takes the process down and the slowest answers in
4 ms.

The four that are not hostile are refusals rather than faults: two files built
to exhaust an XML reader, and two damaged archives whose entries will not
inflate. There is no longer a file in the corpus that Word or Excel opens and
we do not.

No file anywhere took thirty seconds, and no file exhausted a gigabyte of heap.
Slides round-trips every deck in both corpora without a single structural
difference, which is what an eighteen-month-old preservation ADR is supposed to
buy.

### Why files differ, by how many files

Full corpus, counting each file once per cause:

| Files | Cause                                                       | Issue                  |
| ----: | ----------------------------------------------------------- | ---------------------- |
|   165 | an element added or dropped (`child count differs`)         | various                |
|    34 | `w:history` dropped from a hyperlink                        | [#8](../../issues/8)   |
|    31 | a `w:val` changed                                           | various                |
|    21 | a comment's runs rebuilt with our style ids, not the file's | [#7](../../issues/7)   |
|    19 | data validation loses its prompt and error message          | [#4](../../issues/4)   |
|    18 | `xr:uid` dropped from a worksheet                           | —                      |
|    11 | a `w:id` renumbered                                         | various                |
|    10 | a part added or removed                                     | —                      |
|    10 | a row height reformatted (`16.350000000000001` → `16.35`)   | —                      |
|    10 | a row's `s` or `customFormat` dropped                       | [#27](../../issues/27) |
|     6 | a table cell inside a `w:sdt` lost                          | [#28](../../issues/28) |

Eight classes that were in this table after the first run are gone:
namespace declarations (507 files), the paper size code (261), `<cols>`
losing `style` and `bestFit` (251), the rewritten XML declaration (45),
`w:background` (34), the cell style index (18), `xml:space` taken off a run in
a document (15 of 15), and `w:tblPrEx` with `w:gridSpan` (13).

## Formulas

Every `<f>` loaded into `crates/formula`, recalculated, and compared against the
`<v>` its own writer cached beside it.

**Public corpus: 27 workbooks with formulas, 1,709 cells compared, 210 matched.**
**Full corpus: 163 workbooks, 35,949 cells compared, 32,359 matched — 90.0%.**

The public number is two workbooks: `excel2007mac-charts-01.xlsx` is 1,440
cells of `SIN(RADIANS(…))` and `excel2016win-arrayformulas-02.xlsx` is 266 of
`MMULT`/`MINVERSE`/`MDETERM`, and neither family is implemented.

Fewer cells are compared than before because the harness stopped asking every
cell under an array formula for its own answer — the app never did: the covered
cells carry the text so something can ask them what their formula is, and the
corner computes it.

### What the mismatches are

Cells whose formula names a function the engine does not have — 2,052 across
both corpora, grouped by the family a fix would be:

| Cells | Files | Family                  | Names                                                                                                            |
| ----: | ----: | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1,598 |     4 | trigonometry            | `RADIANS`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN`, `DEGREES`                                                |
|   151 |     5 | rounding and integers   | `FLOOR.MATH`, `CEILING.MATH`, `FLOOR.PRECISE`, `CEILING.PRECISE`, `ISO.CEILING`, `EVEN`, `ODD`, `MROUND`, `FACT` |
|   147 |     3 | statistics              | `FORECAST.ETS`, `FORECAST.ETS.CONFINT`, `FREQUENCY`, `AVEDEV`, `DEVSQ`, `MAXA`, `MINA`                           |
|    79 |     5 | distributions and other | `BETA.DIST`, `BINOM.DIST`, `COMBIN`, `DCOUNT`, `DAYS360`                                                         |
|    32 |     2 | engineering             | `HEX2DEC`, `DELTA`                                                                                               |
|    32 |     1 | information and text    | `ISNONTEXT`, `DOLLAR`, `ISREF`, `ERROR.TYPE`                                                                     |
|     9 |     2 | matrix                  | `MMULT`, `MINVERSE`, `MDETERM`                                                                                   |
|     3 |     2 | modern array            | `LET`, `CHOOSEROWS`, `ANCHORARRAY`                                                                               |
|     1 |     1 | pivots                  | `GETPIVOTDATA`                                                                                                   |

And the cells where the engine answered and was wrong:

| Cells | Files | What                                                 | Example                                 | Excel        | Us        |
| ----: | ----: | ---------------------------------------------------- | --------------------------------------- | ------------ | --------- |
|   986 |    10 | a plain reference to a cell whose own answer differs | `Local1`                                | `3`          | `5`       |
|   546 |     8 | `TEXT` and its format codes                          | `TEXT(C4, B4)`                          | `271433.376` | `271433`  |
|    66 |     1 | `ROUND` at high precision                            | `ROUND(B2,12)=ROUND(C2,12)`             | `TRUE`       | `FALSE`   |
|    29 |     7 | a range where a value was expected                   | `AVERAGEIF(A2:B2)`                      | `#NAME?`     | `#VALUE!` |
|    16 |     4 | a three-dimensional reference                        | `SUM(Sheet1:Sheet3!B1)`                 | —            | `0`       |
|    15 |     3 | `IF` over values that differ upstream                | `IF($A3 = $F3, TRUE, FALSE)`            | `TRUE`       | `FALSE`   |
|     6 |     1 | `TRANSPOSE` in an array formula                      | `TRANSPOSE(B6:D8)`                      | `0`          | `#SPILL!` |
|     5 |     3 | a whole column in an arithmetic expression           | `SUMPRODUCT((B:B<>"")/COUNTIF(A:A,K2))` | `1.8`        | `0.2`     |

The first row is not arithmetic: those cells point at other cells whose answers
differ for one of the reasons below them, and they inherit it. Take it out and
the engine disagrees with Excel about 2,500 cells in 36,000, nearly all of them
a function it has never heard of.

81 mismatches are excused as the harness's fault rather than the engine's —
macros, spilled ranges, hidden rows — and `docs/corpus.md` says why.

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
threshold, over the public corpus.

| Format | Files | Identical | Different |
| ------ | ----: | --------: | --------: |
| pptx   |    39 |    **39** |         0 |
| docx   |    34 |        31 |         3 |
| xlsx   |    57 |        56 |         1 |

Eight of the eleven that differed after the first run now render identically,
`word2007win-inlineimage-01.docx` among them — it was 5.9% of a page — and
`unknown-freeze-01.xlsx` has its third page back. What is left:

| File                             | What happens                                                    | Whose fault                                            |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| `word2013win-cjk-01.docx`        | LibreOffice converts the original and refuses the file we saved | ours — [#7](../../issues/7)                            |
| `unknown-sdt-01.docx`            | 0.185% of page 1                                                | ours — [#28](../../issues/28), a cell inside a `w:sdt` |
| `libreoffice-plain-01.docx`      | LibreOffice cannot convert the _original_ either                | LibreOffice's                                          |
| `excel2016win-customxml-01.xlsx` | 0.765% of page 1, down from 7.3%                                | ours, cause not yet found                              |

## What has moved

Each row is one fix, measured on the same files before and after it. The whole
of step 4 so far: **ok 1,429 → 1,910, diff 1,178 → 701, crash 62 → 58** on the
full corpus, with pptx unmoved at 535 and 0.

| Fix                                                                                                                | Corpus                                                     | Before               | After                        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------- | ---------------------------- |
| [#2](../../issues/2) a self-closing `<c/>` swallowing the cells after it ([#19](../../pull/19))                    | 628 workbooks                                              | ok 215, diff 411     | **ok 232**, diff 394         |
|                                                                                                                    | — files losing or gaining elements                         | 79                   | **17**                       |
|                                                                                                                    | — unexplained differences, total                           | 218,926              | **44,680**                   |
| [#9](../../issues/9) packages Word and Excel open and we do not ([#22](../../pull/22), [#24](../../pull/24))       | full corpus                                                | ok 1,446, crash 62   | **ok 1,448**, crash **58**   |
|                                                                                                                    | — crashes with a sentence a person can act on              | 0 of 62              | **58 of 58**                 |
|                                                                                                                    | — non-hostile crashes that are faults rather than refusals | 1                    | **0**                        |
| [#5](../../issues/5), [#16](../../issues/16) a regenerated part keeping what nobody parsed ([#21](../../pull/21))  | full corpus                                                | ok 1,448, diff 1,162 | **ok 1,605**, diff **1,005** |
|                                                                                                                    | — files losing a root's namespace declarations             | 507                  | **3**                        |
|                                                                                                                    | — files whose XML declaration was rewritten                | 45                   | **0**                        |
|                                                                                                                    | — documents losing `w:background`                          | 34                   | **0**                        |
| [#16](../../issues/16) `xml:space` moved from the document to the run ([#23](../../pull/23))                       | full corpus                                                | ok 1,605             | **ok 1,621**                 |
|                                                                                                                    | — files losing it from a run that had it                   | 15                   | **3**                        |
| [#3](../../issues/3) a column and a formula keeping what they said ([#25](../../pull/25))                          | 658 workbooks                                              | ok 238, diff 401     | **ok 321**, diff **318**     |
| [#6](../../issues/6), [#16](../../issues/16) a page keeping its paper, a row its exceptions ([#26](../../pull/26)) | 1,461 documents                                            | ok 832, diff 604     | **ok 1,036**, diff **401**   |
|                                                                                                                    | — files losing `w:pgSz/@w:code`                            | 261                  | **0**                        |
|                                                                                                                    | — files losing `w:tblPrEx` or changing `w:gridSpan`        | 13                   | **0**                        |

The one expectation step 4 did not meet is worth writing down. The serialiser
fix was expected to halve the `diff` count and moved it by 13%, because the
class was enormous by _difference_ and ordinary by _file_: 507 files lost their
namespace declarations, and 349 of them had something else wrong as well. A
file leaves `diff` only when its last cause does.

The render pass earned its keep twice over in this round. It caught a row
whose `w:sdt` had been swept to the front of its cells — half a percent of
moved pixels, two elements in the structural diff, and a table whose columns
had swapped — and it is why `xml:space` on a run can only be added and never
suppressed.

## What this baseline is for

It is the floor. A change that makes any number in it worse needs a reason
written down.

**Not a CI gate yet.** `CORPUS.md` allows one only if it is green on the
baseline, and 53 of 140 public files still differ. What is a gate today is the part
that _is_ green: `pnpm check` runs the charts corpus test and the Slides deck
corpus test over all 140 files, and both pass. When the `diff` count reaches
zero for a format, `pnpm corpus:run` on that format becomes the next gate.

## The issues this run produced

Round-trip and reading:

- ~~[#2](../../issues/2) — xlsx: a self-closing `<c/>` swallows the cells after it~~ — fixed, [#19](../../pull/19)
- [#3](../../issues/3) — xlsx: a column loses `style` and `bestFit` — fixed, [#25](../../pull/25)
- [#4](../../issues/4) — xlsx: data validation loses its prompt and error message
- [#5](../../issues/5) — docx: a regenerated part loses its root namespace declarations — fixed, [#21](../../pull/21)
- [#6](../../issues/6) — docx: `w:tblPrEx` dropped, `w:gridSpan` changed — fixed, [#26](../../pull/26)
- [#7](../../issues/7) — docx: run properties collapse on a Word 2013 CJK document
- [#8](../../issues/8) — docx: `w:history` dropped, and an empty document gains a paragraph
- [#9](../../issues/9) — packages Word and Excel open and we do not — fixed, [#22](../../pull/22) and [#24](../../pull/24)
- [#10](../../issues/10) — charts: a legend edit that does not take, a chart with no series
- [#16](../../issues/16) — docx: paper size code, document background, `xml:space` — fixed, [#21](../../pull/21), [#23](../../pull/23), [#26](../../pull/26)
- [#17](../../issues/17) — xlsx: style indexes change on save — the cell half went with [#19](../../pull/19); the `cfRule/@dxfId` half is open
- [#18](../../issues/18) — the render baseline
- [#27](../../issues/27) — xlsx: a row loses its style, or loses `customFormat`

Formulas:

- [#11](../../issues/11) — `RADIANS`, `MMULT`, `MINVERSE`, `MDETERM`, `GETPIVOTDATA` and others are missing
- [#12](../../issues/12) — `TEXT` and the `A/P` format codes
- [#13](../../issues/13) — array expressions in `SUM` and `COUNTIFS`, implicit intersection
- [#14](../../issues/14) — a circular reference comes out as `0`
- [#15](../../issues/15) — `SUBTOTAL`, `TRANSPOSE`, `SUMPRODUCT`, `INDEX`, `VLOOKUP` on the full corpus
