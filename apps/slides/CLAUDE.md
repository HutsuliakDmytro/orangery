# CLAUDE.md — Orangery Slides

Desktop presentation editor (PowerPoint / Google Slides / Keynote analogue). Sibling of Orangery Docs, lives in the same monorepo. macOS first, Windows + Linux in the first post-MVP update.
Product name: **Orangery Slides**. Bundle id `com.orangery.slides`, binary `orangery-slides`. Read `PLAN.md` (this app) for the roadmap.

## Monorepo

```
orangery/                       pnpm workspace + cargo workspace
  apps/
    docs/                       Orangery Docs (existing app, moved here unchanged in step 0)
    slides/                     this app
  packages/
    ooxml-core/                 zip package, rels, content types, passthrough machinery, XML utils  ← extracted from docs
    ooxml-wordprocessing/       document.xml model (Docs only)
    ooxml-drawingml/            a:* shapes, text bodies, fills, lines, effects, transforms, pictures  ← extracted + extended
    ooxml-presentation/         p:* presentation, slides, layouts, masters, notes, transitions  ← new
    editor-text/                ProseMirror schema + extensions for OOXML text (shared: w:r/w:p and a:r/a:p map to one model)
    ui-kit/                     tokens.css, themes, toolbar/dropdown/dialog components, command registry, palette
    platform/                   OS abstractions (paths, keys, dialogs)
    tauri-shared/               Rust crate: fs atomic write, autosave, updater, menus scaffolding
  tests/fixtures/pptx/          real + synthetic decks
```

Rule: **nothing OS-specific outside `packages/platform/`, nothing Docs-specific inside `packages/`.** If a package needs an app-specific branch, the abstraction is wrong.

## Product principles

- **Familiar.** Layout = PowerPoint/Google Slides: filmstrip left, canvas center, toolbar top, properties panel right, notes bottom. Shortcuts as PowerPoint. When unsure, do what Google Slides does.
- **PPTX is the native format.** No proprietary format. A new deck is a real OOXML package from the first keystroke.
- **Round-trip preservation is a hard requirement.** Open → save without edits → PowerPoint renders identically. Animations, transitions, charts, SmartArt, embedded OLE, comments, custom XML: whatever we don't model is kept verbatim and written back.
- **Presenting must never fail.** Slideshow mode is the one screen that gets tested on a projector before every release.
- **Native feel on macOS.** Native menus, Cmd shortcuts, second-window presenter view, Retina.

## Tech stack (fixed)

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust), from `packages/tauri-shared` |
| UI | React 19 + TS strict + Vite, `packages/ui-kit` |
| Slide canvas | **DOM + SVG.** Shapes as SVG, text bodies as ProseMirror instances overlaid in HTML at the shape's transform. No `<canvas>` for editing. `<canvas>`/WebGL only for slideshow transitions if needed. |
| Text | ProseMirror via `packages/editor-text` (DrawingML text: `a:p`, `a:r`, `a:pPr` with bullets/levels/autofit) |
| State | Zustand; slide model is immutable, edits are transactions with undo history |
| PPTX engine | `packages/ooxml-presentation` + `ooxml-drawingml` — own parser/serializer, JSZip + fast-xml-parser |
| Charts | `c:chart` parts: own SVG renderer for bar/line/pie/doughnut/scatter/area, combination charts and a secondary axis. Editing changes the numbers — both the cache and the embedded workbook, or PowerPoint rebuilds the cache and loses the edit. Categories and the number of points are editable too; the ranges in `c:f` and the workbook's rows move together. |
| Media | video/audio via `<video>`/`<audio>` from media parts; playback in slideshow |
| Other formats | ODP import/export (own layer, same approach), PDF export, PNG/JPEG per slide, `.thmx` theme export, video via canvas capture (real time, engine's container, narration mixed in), Keynote `.key` — no |
| Tests | Vitest, Playwright, cargo test; round-trip corpus + LibreOffice render-diff in CI |

## Design system

Same tokens as Docs (`packages/ui-kit/tokens.css`): black chrome, orange accent, dark default. Slide canvas area background `--surface`, the slide itself renders with its own theme colors — never tinted by app theme.

Ships with one branded deck theme "Orangery" (black background, orange accents, Inter) plus 6–8 neutral themes. Deck themes are real `p:theme` + master + layouts, so they survive in PowerPoint.

Icons: `lucide-react`. Focus ring: orange. Keyboard-complete.

## Model rules

- The in-memory model mirrors PPTX: `Presentation → SlideMaster[] → SlideLayout[] → Slide[]`, each slide has a `spTree` of shapes (`sp`, `pic`, `graphicFrame`, `grpSp`, `cxnSp`). Placeholders (`p:ph`) inherit from layout → master; inheritance is resolved at render time, never baked into the slide on save.
- Coordinates are EMU internally (OOXML native, 914400/inch). Convert to px only in the renderer. Never store px.
- Every shape keeps its original XML subtree; on save, only the properties we model are rewritten into it, the rest is preserved (per-shape passthrough, not just per-file).
- Unknown shape types render as a bounding box with a label and stay untouched. SmartArt is drawn from the `dsp:` drawing part PowerPoint writes beside it — running `dgm:layoutDef` would be writing an interpreter for a language only PowerPoint implements.
- Theme colors (`schemeClr`) stay symbolic in the model; resolve to RGB only in render. Changing the theme must recolor the deck like PowerPoint does.
- Text autofit (`normAutofit`, `spAutoFit`) is computed after layout; results are written as PowerPoint does (`fontScale`, `lnSpcReduction`).

## Editor rules

- All commands in the shared command registry (`ui-kit`); toolbar, menus, palette, context menus read from it.
- Selection model: shapes, then text-in-shape (double-click / Enter). `Esc` walks back out. Multi-select with Shift, marquee, group select.
- Transform handles: move, 8 resize handles, rotate; `Shift` constrains, `Alt` from center, arrows nudge 1 px / `Shift` 10 px.
- Smart guides: snap to slide center, edges, other shapes' edges/centers, equal spacing. Guides drawn in orange.
- Undo/redo is per deck, transaction-based, survives autosave.
- 300-slide deck with images must scroll the filmstrip at 60 fps. Measured: only the thumbnails near the window are drawn at all, which beat caching them as bitmaps — a cache makes the second drawing cheap, and not drawing makes the first one cheap too.

## Slideshow rules

- Separate Tauri window, fullscreen on chosen display; presenter view in another window: current, next, notes, timer, slide grid.
- Navigation: click/space/arrows/PgUp/PgDn, `B`/`W` black/white, number+Enter goes to slide, `Esc` exits.
- Transitions: none, fade, push, wipe, and Morph. Everything else plays as fade and is preserved in the file. Morph pairs the shapes of the two slides by creation id, then name, then kind and text, and refuses to pair where the answer would be a guess.
- Animations play: the main sequence is read from `p:timing` and each click step is one press. Effects this app does not model play as a fade, the same rule transitions follow. Motion paths are not played — the shape sits where it ends. Editing patches `p:timing` in place — a new effect is a new subtree, a removed one is a dropped node — so an effect we cannot describe survives beside one we can. Only effects that can be written exactly are offered: appear, fade, wipe, zoom, pulse.
- Pen, highlighter, laser and eraser during a show, on PowerPoint's own keys. Ink kept at the end is written as freeform shapes rather than as InkML: the room sees the same thing and the file opens everywhere, but ours can be selected afterwards and PowerPoint's is ink.

## File rules

- Atomic writes, `.bak`, autosave snapshots in app data, crash recovery — from `tauri-shared`, same as Docs.
- Media parts are not re-encoded on save. Inserted images are stored as-is (PNG/JPEG), no conversion unless > 20 MB (then offer compression).
- Works fully offline, no telemetry.

## Coding conventions

Same as Docs: TS strict + `noUncheckedIndexedAccess`, functional React, `kebab-case` files, Rust `clippy` clean + `thiserror`, Conventional Commits with scopes `slides`, `drawingml`, `presentation`, `ui-kit`.

## Workflow for Claude Code

1. Read `PLAN.md`, take the first unchecked task in the current phase.
2. Non-trivial change → short plan in chat first; architecture → ADR in `apps/slides/docs/adr/`.
3. Implement → `pnpm check` at the workspace root (lints, typechecks and tests every package) → relevant e2e.
4. Any change in `packages/*` must keep Docs green: run `pnpm --filter docs check` too.
5. Tick the task, summarize. Next phase only when the current one is fully ticked.

```
pnpm install
pnpm --filter slides tauri dev
pnpm check                      # whole workspace
pnpm --filter slides test:e2e
pnpm --filter slides tauri build
```

## Out of scope for MVP

collaboration, cloud, Keynote import, mobile.

## Known hard problems

- **Text autofit** — PowerPoint's shrink-on-overflow is iterative and font-metric dependent; expect ±1 pt differences. Measure with the same fonts bundled.
- **Placeholder inheritance** — three levels with partial overrides; get the resolver right early, test heavily.
- **Charts** — rendering only; even that is a lot of `c:*` XML. Cover the four common types, bounding box for the rest.
- **Fonts** — decks use Calibri/Arial everywhere; bundle metric-compatible fallbacks (Carlito for Calibri, Liberation Sans for Arial) so layout doesn't drift on Linux.
- **Slideshow on a second display** — Tauri multi-window fullscreen behaves differently per OS; test early.
