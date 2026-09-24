# 4. Numbers are doubles, shown to fifteen digits, with one correction

Date: 2026-09-24

## Status

Accepted.

## Context

A spreadsheet is a calculator that people balance ledgers with, and a double
is not a decimal. The two facts do not sit together quietly.

`=0.1 + 0.2 - 0.3` is 5.55e-17 in every programming language ever written and
nought in every spreadsheet ever shipped. A total that should read `0` reading
`-2.22044604925031E-16` instead is one of the oldest complaints there is about
this kind of program, and Excel long ago decided not to argue with it.

We have to decide the same thing, and we have to decide it the same way,
because the product rule is that a workbook opened here shows what it showed
where it came from. A number that differs from Excel's in the fifteenth digit
is a bug of the highest severity — `apps/sheets/CLAUDE.md` says so — and a
number that differs in the seventeenth is invisible until somebody subtracts.

## Decision

**Numbers are IEEE 754 doubles.** No decimal type, no rational type, no
arbitrary precision. A workbook stores doubles, every other spreadsheet reads
doubles, and a model that is more exact than the file would be exact about the
wrong thing.

**Fifteen significant digits is what the program keeps.** This is Excel's own
limit and it shows up in three places:

- what a cell displays under `General` — eleven characters, which is a
  narrower rule again; see `packages/numfmt`;
- what a subtraction is rounded to, below;
- what `ROUND` reads before it rounds: 1.0049999999999999 has seventeen
  digits, and the number a spreadsheet rounds is the fifteen-digit one, which
  is 1.005, which rounds up.

**One correction, in one place.**

### The last subtraction

When a subtraction's result is smaller than the fifteenth significant digit of
the larger operand, it is nothing.

```
result / max(|left|, |right|) < 1e-15   →   0
```

Otherwise the result is rounded to fifteen significant digits. That is what
makes `=(43.1 - 43.2) + 1` come to 0.899999999999999 rather than
0.8999999999999999 — Microsoft's own published example for this behaviour, and
a good illustration that the correction applies to the subtraction and not to
the expression around it. Subtract first and the error is carried into what
follows, where nothing takes it back out.

`crates/formula/src/eval.rs`, `subtract`.

### And nowhere else — not even where it looks as though it should

The correction belongs to the **subtraction operator**. It does not apply to a
column added up by `SUM`, `AVERAGE`, `SUMIF` or `SUMPRODUCT`, however much it
looks as though consistency demands it.

That is not a preference. It was the first thing tried here, and the corpus
threw it out. POI's `FormulaEvalTestData.xlsx` has, in D180:

```
=AVERAGE(B7:C15,B16:C17,D8:D16)     →   -4.0893554731909327E-9
```

Those ranges hold 9999999999 and −9999999999 among much smaller numbers. They
cancel, the small numbers lose their lower digits doing it, and what is left
is about one part in 1e17 of the largest number in the column — far below the
fifteenth digit. **Excel kept it.** Had Excel applied the subtraction rule to
`AVERAGE`, that cell would read `0`, and it does not.

So `SUM(a, b, −a, −b)` and `a + b − a − b` give different answers — a crumb
from the first and nought from the second — in Excel and therefore here. That
looks like a bug and is the specified behaviour, which is exactly the sort of
thing this file exists to record.

### Nothing else is corrected at all

In particular, the rule does not tidy up arithmetic that is merely inexact. A
tenth and two tenths and three tenths is not six tenths, here or in Excel:
`SUM(0.1, 0.2, 0.3) = 0.6` is `FALSE` in both programs. The rule takes out
what is not there. It does not put right what is.

Multiplication and division are not corrected. `0.1 * 3` is
0.30000000000000004 and stays that way.

## Consequences

A cell can hold a number that its own display contradicts. `=0.1 + 0.7` shows
`0.8` and is not equal to `0.8`. This is true of Excel as well, it is the
single most frequent surprise in spreadsheet arithmetic, and no amount of
correction removes it without breaking something worse.

Comparisons are not corrected. `=A1 = B1` on two cells that differ in the
seventeenth digit is `FALSE`. Excel behaves the same way, and it is the reason
people are taught to compare rounded values.

The threshold is exactly `1e-15` and the comparison is strict, which leaves a
boundary nobody here has been able to test. `=1E15 + 1 - 1E15` is nought,
because the larger operand of the final subtraction is 1000000000000001 and
one part in that is below the threshold; one part in exactly 1e15 would not
be, by a hair of floating point. **We do not know where Excel draws that
line**, the corpus contains no workbook that asks, and inventing an answer
would be worse than recording the question. If a real Excel is ever to hand,
that is the example to try.

## Evidence, and the lack of it

Of the 35,980 corpus cells with a cached value, exactly **one** turns on this
decision — the `AVERAGE` above — and it turned it the opposite way from the
one this ADR was drafted to take. That is worth saying plainly: the reasoning
was that two spellings of one sum cannot give two answers; the reasoning was
sound; it was wrong, because Excel is not obliged to be consistent and the
file proved that it is not.

Nothing in the corpus exercises the subtraction rule itself. Those workbooks
are tables of function calls written to test functions, not ledgers that have
been added up and subtracted from, and the arithmetic in them never
accumulates enough error to show. So the expectations for that half of
`crates/formula/tests/precision.rs` come from Microsoft's published examples
for the behaviour, which is the best authority available here and is not a
real Excel. The test file says which rows are which.

## See also

- `crates/formula/tests/precision.rs` — the rules as tests
- `packages/numfmt` — what a number looks like once it has been computed,
  which is a separate language with its own table of evidence
  (`tests/fixtures/number-formats.tsv`)
