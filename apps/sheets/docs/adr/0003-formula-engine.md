# 0003 — The formula engine is ours, and it is in Rust

- Status: accepted
- Date: 2026-09-20

## Context

A spreadsheet is a calculator that keeps its working. Everything built so far
— the grid, the styles, the round trip — is the part people see; the part they
come for is that `=SUM(B2:B13)` is right, stays right when a row is inserted
above it, and agrees with the number Excel put in the same cell yesterday.

`apps/sheets/CLAUDE.md` states the bar: "A formula result that differs from
Excel is a bug of the highest severity." That sentence decides more than it
looks.

Three questions had to be answered before writing any of it.

### Why not an existing engine

HyperFormula is the obvious candidate and is out on licence: GPLv3 or a paid
commercial licence, and this ships as a signed desktop app under MIT.
Formulajs is a function library rather than an engine — no dependency graph,
no recalculation, no references — so it answers the small half of the problem
and leaves the large one. The other options are abandoned, or are thin wrappers
around a spreadsheet nobody has.

There is a deeper reason than licensing. Excel compatibility is not a feature
that can be bolted on: it is thousands of small decisions about coercion,
precision and error propagation, and an engine that made different ones is an
engine whose every disagreement has to be patched from outside. Owning the
decisions is the only way to own the bar.

### Why Rust rather than TypeScript

The budget in `PLAN.md` is a full recalculation of a million formulas in under
two seconds, and one edit with ten thousand dependants in under fifty
milliseconds. That is a graph walk over a few million nodes with a numeric
evaluation at each — the kind of work where a JIT's warm-up, the garbage
collector's pauses and boxed numbers each cost more than the arithmetic.

The shell is already Rust (`src-tauri`), so there is no new toolchain and no
new process: the engine is a crate the app links, called over the command
bridge the app already has. And a pure library with no I/O compiles to WASM
for the web viewer without a second implementation, which is the only way the
viewer and the app can be trusted to agree.

### Why a crate of its own

`crates/formula` is not part of `orangery-sheets`. It has no Tauri, no
filesystem, no notion of a workbook file — it is given cells and asked for
values. That keeps it testable without a window, usable from the WASM build,
and honest about its boundary: a function that needs to know what a file is
does not belong in it.

## Decision

**Own engine, Rust, pure library, in `crates/formula`.**

### The shape of it

```
parse:   text  → tokens → AST
model:   AST   + a sheet of cells → value
graph:   cell  → what it depends on, and what depends on it
recalc:  dirty set → topological order → values
```

Four stages, each testable alone. The parser knows nothing about values; the
evaluator knows nothing about the graph; the graph knows nothing about what a
function does.

### What the parser accepts

Everything a `.xlsx` can hold, because the parser is not only for what people
type — it is for every formula in every file that is opened. A formula it
cannot parse is a formula the app would have to drop on save, and dropping
somebody's formula is worse than not computing it.

So: A1 references with `$` on either half, ranges, whole rows and columns,
3-D references across sheets, quoted sheet names, structured table references,
defined names, external references, the operators including the two that are
written as whitespace and a comma, array literals, `%`, unary minus and plus,
and the `_xlfn.` prefixes Excel writes for functions older readers lack.

An unknown _function_ is not a parse error: it parses, it evaluates to
`#NAME?`, and it is written back into the file exactly as it came. That is the
rule that keeps a workbook using something we have not implemented from being
a workbook we damage.

### Numbers are Excel's, not IEEE's

Excel is not a pure IEEE 754 machine and pretending otherwise puts
`=0.1+0.2-0.3` on screen as `5.55e-17` where every other spreadsheet shows a
nought. The rules are specific and are implemented as rules:

- Fifteen significant decimal digits are displayed, and a result is rounded to
  fifteen before it is shown or compared.
- A subtraction whose operands are close enough that the result is dominated
  by representation error is snapped to zero — Excel's own last-step
  correction.
- `ROUND` is half away from zero, not banker's rounding.
- Dates are serial numbers in the workbook's own system, including the 1900
  leap-year bug, because a workbook that disagreed with Excel about the 29th of
  February 1900 would disagree about every date before it.

### Errors are values

`#DIV/0!`, `#N/A`, `#NAME?`, `#NULL!`, `#NUM!`, `#REF!`, `#VALUE!`, `#SPILL!`,
`#CALC!` are values of the language, not exceptions. They propagate through
arithmetic, they are caught by `IFERROR`, and `#N/A` beats the others where
both reach the same operator — which is what Excel does and what makes a
lookup down a column behave.

### Tests are Excel's answers, not ours

Every function ships with at least five cases whose expected values came out of
Excel, and the corpus test recomputes real workbooks and compares against the
values Excel cached in them. A test written from our own implementation proves
only that the implementation has not changed; against a cached Excel value it
proves the thing the bar demands.

## Consequences

- A second language in the build for anyone working on formulas, and a bridge
  to cross for anything the UI needs from them. Both were already there for
  the shell.
- The engine cannot be tested from the app's vitest suite. It has `cargo test`,
  and the app tests the bridge rather than the arithmetic.
- The WASM build is a constraint on every dependency: no `std::fs`, no
  threads, nothing platform-shaped, for the whole life of the crate.
- Function coverage becomes a long tail of small work rather than one large
  piece. The registry is built so that adding one is adding one file and one
  line, because there will be hundreds.
