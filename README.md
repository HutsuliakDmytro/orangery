# Orangery

An office suite that treats OOXML as its own format — not as something to import.

Word and PowerPoint files are not a foreign format to be read approximately and
rewritten. They are the format. Orangery opens one, edits it, and writes it back
with everything it does not model kept exactly as it was found.

---

## Apps

| App                                       | Native format | Status                                                                                                     |
| ----------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| **[Docs](apps/docs)** — word processor    | `.docx`       | pre-release, [`v0.1.0`](https://github.com/HutsuliakDmytro/orangery/releases) — macOS built and used daily |
| **[Slides](apps/slides)** — presentations | `.pptx`       | in development                                                                                             |

Each app is its own product: its own binary, its own icon, its own release tag,
its own updater channel. Nothing in one requires the other to be installed. They
share a repository because they share their foundations, not because they ship
together — see [ADR 0001](docs/adr/0001-monorepo.md).

## Why it is one repository

A `.docx` and a `.pptx` are the same thing underneath: a zip of XML parts tied
together by relationships. The machinery that matters — holding a package as read,
carrying unmodelled markup through untouched, resolving DrawingML, editing runs of
text — is one body of code serving two documents. Splitting it across repositories
would buy version skew and a publish step, and would cost the thing that makes the
fidelity guarantee hold: one fix, in one place, for both apps.

```
apps/
  docs/                  Orangery Docs
  slides/                Orangery Slides
packages/
  ooxml-core/            zip package, relationships, content types, passthrough
  ooxml-wordprocessing/  word/document.xml model
  ooxml-drawingml/       shapes, text bodies, fills, transforms, pictures
  ooxml-presentation/    presentation, slides, layouts, masters, notes
  editor-text/           ProseMirror schema for OOXML text
  ui-kit/                tokens, themes, toolbar, command registry, palette
  platform/              the only place with OS checks
  tauri-shared/          Rust: atomic writes, autosave, updater, menus
```

Packages are being extracted from Docs as Slides needs them; the tree above is the
destination, not the current state.

## Development

Requires Node 22, pnpm and a stable Rust toolchain.

```sh
pnpm install

pnpm check                    # format, lint, typecheck and test every package
pnpm --filter docs tauri dev  # run Docs
pnpm --filter docs check      # just that app
```

A change under `packages/` has to keep every app green — `pnpm check` at the root
is the gate. See [CLAUDE.md](CLAUDE.md) for the workspace-wide rules and each app's
own `CLAUDE.md` for its.

## License

MIT — see [LICENSE](LICENSE).
