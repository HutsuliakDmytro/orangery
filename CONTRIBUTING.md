# Contributing

Thanks for looking. This is a word processor whose whole promise is that it does
not damage the documents people put into it, so the bar for changes that touch
reading or writing a file is higher than the bar for changes that touch the
interface.

## Before you start

The roadmap is [PLAN.md](PLAN.md) — the first unticked task in the current phase
is usually the right thing to pick up. The conventions the code follows are in
[CLAUDE.md](CLAUDE.md), and the decisions worth arguing about are written down in
[`docs/adr/`](docs/adr/). If you are about to make a decision of that kind, add
an ADR rather than a comment.

## Running it

Node 22, pnpm, Rust stable.

```bash
pnpm install
pnpm tauri dev
```

## Before you open a pull request

```bash
pnpm check        # lint, typecheck, unit tests
pnpm test:e2e     # Playwright
```

If the change touches `src-tauri/`:

```bash
cargo clippy --all-targets -- -D warnings
cargo test
```

`--all-targets` is the part that matters: without it clippy skips the test
target, so a changed struct compiles clean locally and fails in CI.

## What a good change looks like

**One feature or fix per branch**, with [Conventional Commits](https://www.conventionalcommits.org)
(`feat(docx): …`, `fix(editor): …`). A commit message should say why the change
is right, not what the diff already shows.

**Nothing is dropped in silence.** If the app cannot represent something in a
file, it either preserves it untouched or reports it in the warnings banner.
A converter that quietly loses a table is a worse bug than one that crashes,
because nobody finds out until the document matters.

**Tests at the level the bug lives at.** Most logic is testable without a DOM,
and should be. But some things — whether a list marker is visible, how wide a
tab ends up, where a page break lands — are only true once a browser has laid
the page out, and those belong in `tests/e2e/`. Several bugs in this repository
were invisible to every unit test while being plainly wrong on screen.

**Comments explain why.** The code already says what it does. A comment earns
its place by explaining a constraint, a format quirk, or the reason an obvious
approach was not taken.

## Reporting a bug

A document that reproduces it is worth more than a description — but please
check it first for anything you would not want to publish. A synthetic file that
shows the same problem is better still, and can go straight into
`tests/fixtures/`.
