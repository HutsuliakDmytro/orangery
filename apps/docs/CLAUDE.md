# CLAUDE.md — Orangery Docs

Desktop word processor (Microsoft Word / Google Docs analogue). macOS first, Windows + Linux in the first post-MVP update.
Product name: **Orangery Docs**. App bundle id `com.orangery.docs`, binary/folder name `orangery-docs`. Read `PLAN.md` for the phased roadmap and current task list.

## Product principles

- **Familiar, not novel.** Layout and shortcuts must feel like Word/Docs. No UI experiments. When unsure, do what Google Docs does.
- **Native feel on macOS.** Native menu bar, Cmd shortcuts, traffic lights, system file dialogs, Retina rendering.
- **Documents are sacred.** Never lose user data: autosave, crash recovery, atomic writes, backups before overwrite.
- **Cross-platform by design, macOS by priority.** No macOS-only code paths in shared modules; platform specifics go behind `src/platform/`.

## Tech stack (fixed — do not swap without discussion)

| Layer              | Choice                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Shell / native     | Tauri 2 (Rust)                                                                                                             |
| UI                 | React 19 + TypeScript (strict) + Vite                                                                                      |
| Editor core        | ProseMirror via Tiptap 2 (custom extensions live in `src/editor/extensions/`)                                              |
| State              | Zustand (no Redux)                                                                                                         |
| Styling            | Tailwind + CSS variables for theme tokens (`src/styles/tokens.css`)                                                        |
| Native file format | **DOCX (OOXML)**. No proprietary format, ever.                                                                             |
| DOCX engine        | Own layer `src/ooxml/`: JSZip + fast-xml-parser, bidirectional DOCX ⇄ ProseMirror, round-trip preserving (see rules below) |
| Other formats      | ODT (own, same approach), RTF/TXT/MD/HTML (import+export), legacy `.doc` — read-only via `antiword`-style parser, post-MVP |
| PDF / print        | Tauri print to PDF (webview), fallback via Rust `printpdf` later                                                           |
| Tests              | Vitest + React Testing Library (UI), Playwright (e2e via tauri-driver), `cargo test` (Rust)                                |
| CI                 | GitHub Actions: lint, test, macOS build + notarize                                                                         |

Package manager: **pnpm**. Node 22, Rust stable.

## Repo layout

```
src/                 React app
  app/               shell: layout, menus, window chrome, command palette
  editor/            Tiptap setup, extensions, schema, commands, keymaps
  ooxml/             DOCX parser/serializer: package, document.xml, styles, numbering, media, passthrough
  document/          open/save orchestration, format detection, converters (odt, rtf, md, html), autosave, recent files
  platform/          per-OS abstractions (paths, shortcuts, dialogs) — only place with OS checks
  components/        reusable UI (toolbar, dropdowns, dialogs, sidebar)
  styles/            tokens.css, themes (dark default / light), print.css
  store/             Zustand stores
src-tauri/           Rust: commands, fs, native menus, updater, file associations
tests/               e2e
docs/                ADRs (docs/adr/NNNN-title.md) — one per non-trivial decision
```

## Design system

Brand colors: **black + orange**. Two themes, dark is default.

```
--bg:            #0B0B0B   (dark)  / #FFFFFF (light)
--surface:       #161616   / #F5F5F5
--surface-2:     #1F1F1F   / #EAEAEA
--border:        #2A2A2A   / #DADADA
--text:          #F2F2F2   / #111111
--text-muted:    #9A9A9A   / #666666
--accent:        #FF7A00   (orange — primary actions, selection, focus rings, cursor)
--accent-hover:  #FF8F2A
--accent-soft:   rgba(255,122,0,0.15)
--page:          #FFFFFF   (the document page itself is ALWAYS white in both themes unless user picks "page dark mode")
--danger:        #FF3B30
```

- Orange is an accent, not a wallpaper. Chrome is black/grey; orange marks active state, primary buttons, selection highlight, links.
- Font: system UI (`-apple-system, Segoe UI, ...`) for chrome. Document defaults: Arial 11pt, line height 1.15, like Docs.
- Toolbar: single-row Docs-style toolbar (not Word ribbon), plus native menu bar for everything.
- Icons: `lucide-react` only.
- All interactive elements need keyboard access and visible focus (orange ring).

## Editor rules

- ProseMirror schema is the source of truth. Never manipulate the DOM of the editor directly.
- Every formatting feature = a Tiptap extension with: schema, commands, keymap, input rules (where sensible), toolbar binding.
- Commands are registered in `src/editor/commands/registry.ts` with `{ id, label, shortcut, run, isActive?, isEnabled? }`. Menus, toolbar and command palette all read from the registry — no duplicated logic.
- Shortcuts use `Mod` (Cmd on mac, Ctrl elsewhere) from `src/platform/keys.ts`. Never hardcode `Cmd`.
- Undo/redo history must survive autosave.
- Large docs (100+ pages) must stay responsive: no full re-renders on keystroke, measure before adding decorations.

## Document / file rules

- **DOCX is the native format.** New documents are DOCX. "Save" on a `.docx` writes DOCX. No app-specific format exists or will exist.
- **Round-trip preservation is a hard requirement.** Opening a DOCX and saving it without edits must produce a file that Word/LibreOffice render identically. Implementation: the parsed package (`styles.xml`, `numbering.xml`, `settings.xml`, `theme`, `fontTable`, headers/footers, custom XML, `rels`, media) is kept in memory as-is; only `document.xml` is regenerated from ProseMirror, and unknown elements inside it are kept as opaque `passthrough` nodes and written back verbatim.
- ProseMirror schema is modelled on OOXML concepts (paragraph props, run props, numbering instances, section props, styles) — not on HTML. Map Word semantics 1:1 where possible so that nothing is invented on export.
- Every unsupported construct on import: keep as passthrough, log to `document.warnings[]`, show a non-blocking "some content may not display" banner. Never crash, never silently drop.
- Writes are atomic: write to temp → fsync → rename. Before overwriting a user file, keep one `.bak` copy (configurable).
- Autosave/crash recovery uses an internal snapshot in app data (`<appdata>/autosave/<hash>/`, ProseMirror JSON + preserved package parts). This is a cache, never a user-facing format, never exposed in Save dialogs.
- Fidelity test corpus lives in `tests/fixtures/docx/` — real documents from Word (mac/win), Google Docs export, LibreOffice. Round-trip tests compare `document.xml` structurally and via LibreOffice → PDF render diff in CI.
- The app must open fine with zero network access. No telemetry in MVP.

## Coding conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. No `any` without a `// why:` comment.
- Functional components + hooks. No class components.
- File names: `kebab-case.ts(x)`, components `PascalCase` inside.
- Rust: `clippy` clean, `thiserror` for errors, every Tauri command returns `Result<T, AppError>`.
- Commit messages: Conventional Commits (`feat(editor): …`, `fix(docx): …`).
- Keep PR-sized changes: one feature or fix per branch.

## Workflow for Claude Code

1. Read `PLAN.md`, find the first unchecked task in the current phase.
2. Before implementing anything non-trivial, write a short plan in the chat; for architectural choices, add an ADR in `docs/adr/`.
3. Implement → run `pnpm check` (lint + typecheck + unit tests) → run the relevant e2e if it exists.
   - A change touching `src-tauri/` also needs `cargo clippy --all-targets -- -D warnings` and `cargo test`. `--all-targets` is the part that matters: without it clippy skips the test target, so a changed struct or signature compiles clean locally and fails in CI.
4. Tick the task in `PLAN.md` and summarize what changed.
5. Do not start the next phase until every task in the current one is ticked and `pnpm check` is green.

Commands:

```
pnpm install
pnpm tauri dev          # run the app
pnpm check              # lint + tsc + vitest
pnpm test:e2e           # playwright via tauri-driver
pnpm tauri build        # release build (macOS: signed + notarized in CI only)
```

## Explicitly out of scope for MVP

Real-time collaboration, cloud sync, spell check, plugins, mobile. Do not add scaffolding for them "just in case".

Comments and track changes were moved back into scope on 2026-09-17 — see `PLAN.md`, phase 4.5.5. They are single-user features here: reviewing a document you were sent, not editing one with somebody at the same time.

## Known hard problems (see PLAN.md risks)

- True WYSIWYG pagination in ProseMirror. MVP uses a page-styled continuous view with visual page boundaries; real page-flow layout is a post-MVP task.
- DOCX fidelity — this is the core of the product, not a feature. Prioritize: never break what we didn't touch (passthrough), then render correctly, then edit correctly. Editing an unsupported construct converts it to the closest supported one, with a warning.
- Fonts differ across OSes — bundle a small set of open fonts (Inter, Liberation family) for consistent rendering.
