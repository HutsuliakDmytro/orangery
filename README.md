# Orangery

**An office suite that treats OOXML as its own format — not as something to import.**

[![check](https://github.com/HutsuliakDmytro/orangery/actions/workflows/check.yml/badge.svg)](https://github.com/HutsuliakDmytro/orangery/actions/workflows/check.yml)
[![build](https://github.com/HutsuliakDmytro/orangery/actions/workflows/build.yml/badge.svg)](https://github.com/HutsuliakDmytro/orangery/actions/workflows/build.yml)
[![license](https://img.shields.io/badge/license-MIT-black)](LICENSE)

A `.docx`, a `.pptx` and an `.xlsx` are not a foreign format to be read approximately
and rewritten. They are **the** format. Orangery opens one, edits it, and writes it
back with everything it does not model kept exactly as it was found.

---

## The promise

Open a file and save it without touching anything, and you get the file you opened.
Not something that renders close enough — the same bytes, for every part the app has
no opinion about.

That is not a feature, it is the constraint the whole thing is built around. It is why
the parsed package stays in memory as it was read, why unknown markup is carried
through as opaque passthrough rather than dropped, and why a workbook with pivot
caches, macros and a Power Query connection survives an editing session in a program
that does none of those things.

Desktop apps. They open offline, they have no telemetry, and they write your files
atomically with a backup behind them.

## Apps

| App                                       | Native format    | What it is                                                                 | Status                                                                                          |
| ----------------------------------------- | ---------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **[Docs](apps/docs)** — word processor    | `.docx`          | Word / Google Docs. Styles, numbering, tables, comments, track changes.    | pre-release [`v0.1.0`](https://github.com/HutsuliakDmytro/orangery/releases) — macOS, daily use |
| **[Slides](apps/slides)** — presentations | `.pptx`          | PowerPoint / Keynote. Masters, layouts, shapes, animation, presenter view. | in development                                                                                  |
| **[Sheets](apps/sheets)** — spreadsheet   | `.xlsx`, `.xlsm` | Excel / Google Sheets. Canvas grid, 250+ functions, charts, pivots read.   | in development                                                                                  |

Each app is its own product: its own binary, its own icon, its own bundle id, its own
release tag, its own updater channel. Nothing in one requires the other to be
installed. They share a repository because they share their foundations, not because
they ship together — see [ADR 0001](docs/adr/0001-monorepo.md).

## Why it is one repository

A `.docx`, a `.pptx` and an `.xlsx` are the same thing underneath: a zip of XML parts
tied together by relationships. The machinery that matters — holding a package as
read, carrying unmodelled markup through untouched, resolving DrawingML, drawing a
chart, editing runs of text — is one body of code serving three documents. Splitting
it across repositories would buy version skew and a publish step, and would cost the
thing that makes the fidelity guarantee hold: one fix, in one place, for every app.

The chart engine is the clearest case. A chart in a document, a chart on a slide and a
chart on a sheet are the same `c:chartSpace` markup with the same renderer behind it —
and the little workbook a document embeds for its chart is read by the same code that
opens a spreadsheet.

```
apps/
  docs/                  Orangery Docs         .docx
  slides/                Orangery Slides       .pptx
  sheets/                Orangery Sheets       .xlsx
packages/
  ooxml-core/            the package itself: zip parts, relationships, content types
  ooxml-drawingml/       a:* and pic:* — shapes, text bodies, fills, transforms
  ooxml-presentation/    p:* — a deck, its slides, layouts and masters
  ooxml-spreadsheet/     SpreadsheetML — a workbook, its sheets and the cells in them
  charts/                c:* — one model, one SVG renderer, three apps
  grid/                  a grid of cells drawn on a canvas
  numfmt/                Excel number format codes: what a cell shows for what it holds
  editor-text/           the ProseMirror model w:p and a:p share
  ui-kit/                command registry, theme tokens, dialogs, palette
  fonts/                 the families that ship, so a file looks the same on every OS
  platform/              the only place that asks which operating system it is on
  render-diff/           renders a file before and after a round-trip and compares
  tauri-shared/          Rust: atomic writes, autosave, crash recovery, menus
crates/
  formula/              the spreadsheet formula engine — parser, graph, 250+ functions
```

Docs still keeps its own `.docx` layer under `apps/docs/src/ooxml`; it moves out to
`packages/` when a second app needs it, and not before.

## Development

Requires Node 22, pnpm and a stable Rust toolchain.

```sh
pnpm install

pnpm check                      # format, lint, typecheck and test every package
pnpm --filter docs tauri dev    # run Docs
pnpm --filter slides tauri dev  # run Slides
pnpm --filter sheets tauri dev  # run Sheets

cargo test                      # the Rust side, including the formula engine
```

A change under `packages/` has to keep every app green — `pnpm check` at the root is
the gate. Timed benchmarks are asked for by name rather than run with the suite
(`pnpm --filter sheets test:speed`, `cargo test -p formula -- --ignored`): a test that
fails because something else on the machine was busy is a test people learn to ignore.

See [CLAUDE.md](CLAUDE.md) for the workspace-wide rules, each app's own `CLAUDE.md` for
its own, and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Releases

Each app ships on its own tag, and a tag is the only thing that publishes:

```sh
git tag sheets-v0.1.0 && git push origin sheets-v0.1.0
```

That builds macOS (universal), Windows and Linux, and attaches the `.dmg`, `.exe`,
`.deb` and `.AppImage` to a GitHub release. Every other push builds the same way and
stops there, so a branch that would not package is known before it is tagged.

Builds are **not signed or notarized yet**, which is why releases are marked
pre-release: macOS and Windows will both warn before running them.

## License

MIT — see [LICENSE](LICENSE).
