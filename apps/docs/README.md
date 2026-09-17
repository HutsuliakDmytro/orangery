# Orangery Docs

A desktop word processor that treats `.docx` as its own format — not as something to import.

Orangery Docs opens a Word document, edits it, and writes it back. Everything it
does not model is kept exactly as it was found, byte for byte, so a document
that passes through it comes out the way it went in.

> **Status: pre-release.** macOS is built and used daily. Windows and Linux
> compile and bundle in CI but have not been run by a human yet — see
> [Platforms](#platforms).

---

## Why

Most editors that open `.docx` treat it as an import format: they read what they
understand, drop the rest, and write a new file that is _approximately_ the
document you gave them. Open a colleague's thesis, change one word, save, and
the numbering is gone, the headers are gone, the tracked changes are gone.

Orangery Docs is built the other way round. The package is held as read, only
`word/document.xml` is regenerated, and anything unmodelled inside it is carried
through untouched. Round-trip fidelity is the product, not a feature of it — see
[ADR 0003](docs/adr/0003-docx-native-roundtrip.md).

## What it does

**Writing**
Paragraph and character styles read from the document itself, applied, created
from a selection or updated to match one · multilevel heading numbering
(`1.` / `1.1.` / `1.1.1.`, or `I.` / `A.` / `1.`) · a table of contents built
from those headings, and lists of figures and of tables built from the captions
· captions that number themselves through `SEQ` fields · footnotes · tab stops
with dotted leaders, set from the ruler · find and replace · an outline panel.

**Page**
Sections with their own page setup, orientation and margins · page numbering
with a format and a starting number · headers and footers per section, with a
separate pair for the first page · text columns · paragraph pagination — keep
with next, keep lines together, page break before, widow control.

**Review**
Comments anchored to a stretch of text, in their own part of the file · tracked
changes: insertions, deletions and changes of formatting, recorded as you type
and accepted or rejected per selection or all at once.

**Everything else**
Tables with merges, borders and drag-resized columns · images with wrapping ·
format painter · typographic substitution while typing, with quotation marks
that follow the language being written · autosave and crash recovery · atomic
writes with a `.bak` copy · dark and light themes · English and Ukrainian
interface.

## Formats

| Format         | Read | Write | Notes                                                          |
| -------------- | ---- | ----- | -------------------------------------------------------------- |
| **DOCX**       | ✅   | ✅    | The native format. Unmodelled markup round-trips verbatim.     |
| **ODT**        | ✅   | ✅    | Package preserved the same way. Styles, lists, tables, images. |
| **RTF**        | ✅   | ✅    | Text formatting, lists, tables, images (PNG and JPEG).         |
| **HTML**       | ✅   | ✅    | Sanitised on the way in: an allowlist, never a blocklist.      |
| **Markdown**   | ✅   | ✅    | Nested lists, tables, images.                                  |
| **Plain text** | ✅   | ✅    |                                                                |
| **PDF**        | —    | ✅    | Through the webview's own print path.                          |

Anything the app cannot represent is either preserved untouched or reported in a
banner. It is never dropped in silence — that rule is what most of the test
suite is about.

## Platforms

|         | Builds   | Bundles          | Run by a person |
| ------- | -------- | ---------------- | --------------- |
| macOS   | ✅       | `.app`, `.dmg`   | ✅              |
| Windows | ✅ in CI | `.exe` (NSIS)    | ❌ not yet      |
| Linux   | ✅ in CI | `.deb`, AppImage | ❌ not yet      |

Operating-system differences live only in `src/platform/` and in one constant in
the Rust menu builder. Shortcuts are written as `Mod` and resolve to Cmd or Ctrl;
the menu bar is built to the shape each platform actually has. Printing has not
been checked on WebView2 or WebKitGTK.

## Known limits

Stated plainly, because a surprise is worse than a limitation:

- **Pagination is approximate.** Page breaks land at block boundaries, not
  mid-paragraph. True page-flow layout in ProseMirror is a post-MVP problem.
- **Columns are drawn only for a document that is a single section.** CSS lays
  columns out on a container, and a section is a run of blocks without one. The
  file still round-trips, and Word lays it out properly.
- **Comment replies and resolution** are not implemented; they live in a
  separate `commentsExtended.xml` part.
- **Images behind or in front of text** (`wrapNone`) are preserved but not
  editable — CSS has no equivalent, and moving one into the text flow would
  move it on the page.

## Getting started

Requires **Node 22**, **pnpm** and **Rust stable**.

```bash
pnpm install
pnpm tauri dev      # run the app
pnpm check          # lint, typecheck, unit tests
pnpm test:e2e       # Playwright, in a real browser engine
pnpm tauri build    # release bundle
```

Changes under `src-tauri/` also need:

```bash
cargo clippy --all-targets -- -D warnings
cargo test
```

## How it is put together

| Layer     |                                                                                            |
| --------- | ------------------------------------------------------------------------------------------ |
| Shell     | Tauri 2 (Rust) — file access, native menus, window lifecycle                               |
| Editor    | ProseMirror through Tiptap 2, with the schema modelled on OOXML rather than on HTML        |
| OOXML     | `src/ooxml/` — the DOCX reader and writer, and the units, styles and numbering behind them |
| Documents | `src/document/` — opening, saving, converters, autosave                                    |
| Interface | React 19, Zustand, Tailwind 4                                                              |

Two ideas carry most of the design:

**Preserve, then model.** Every part of the package is held as it was read. Only
`document.xml` is rebuilt, and each element inside it either maps onto something
the editor understands or is written back verbatim. A paragraph nobody edited
produces the same bytes it arrived as.

**One registry of commands.** Menus, toolbar, command palette and keyboard all
read the same list — see [ADR 0002](docs/adr/0002-command-registry.md). A command
is defined once and appears everywhere, with its state and its shortcut.

The decisions worth arguing about are written down in [`docs/adr/`](docs/adr/).

## Tests

```
1446  unit and component (Vitest)
  28  end to end (Playwright, real browser)
  29  Rust
```

The end-to-end tests exist for what nothing below a browser can see: whether a
list actually has a marker on it, how wide a tab is once the text is laid out,
where a page break falls. More than one bug in this repository was invisible to
every unit test while being plainly wrong on screen.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: `pnpm check` green, one
feature per branch, Conventional Commits, and a comment only where the code
cannot say it itself.

The roadmap is [PLAN.md](PLAN.md); the conventions the code follows are in
[CLAUDE.md](CLAUDE.md).

## Licence

[MIT](LICENSE).
