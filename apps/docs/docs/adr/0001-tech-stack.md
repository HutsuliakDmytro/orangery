# 0001 — Tech stack

- Status: accepted
- Date: 2026-09-16

## Context

Orangery Docs is a desktop word processor (Word / Google Docs analogue), macOS first,
Windows and Linux in the first post-MVP update. It is built by one developer with
Claude Code, so the stack has to favour a small surface area, mature libraries and a
single language for the bulk of the product code.

Hard constraints from the product:

- Must feel native on macOS (menu bar, Cmd shortcuts, system dialogs, Retina).
- Must ship as a signed, notarized desktop app, not a web page.
- Must never lose documents: atomic writes, autosave, crash recovery.
- Must open with zero network access; no telemetry in MVP.
- Rich text editing with full control over the document model (see 0002 for DOCX).

## Decision

| Layer          | Choice                               |
| -------------- | ------------------------------------ |
| Shell / native | Tauri 2 (Rust)                       |
| UI             | React 19 + TypeScript strict + Vite  |
| Editor core    | ProseMirror via Tiptap 2             |
| State          | Zustand                              |
| Styling        | Tailwind 4 + CSS variables           |
| Tests          | Vitest + RTL, Playwright, cargo test |
| CI             | GitHub Actions                       |
| Package mgr    | pnpm                                 |

## Rationale

**Tauri 2 over Electron.** ~10 MB bundles instead of ~150 MB, lower idle memory, and a
Rust backend for the parts that must not be in a JS sandbox: atomic file writes, fsync,
file associations, native menus, the updater. Trade-off accepted: the webview is the OS
one (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), so rendering differs
per platform and must be tested on all three. Electron's uniform Chromium is the thing
we give up; bundle size, memory and native integration are what we buy.

**ProseMirror via Tiptap 2.** A word processor needs a real document model with
schema validation, transactions and collaborative-ready positions — not `contenteditable`
with `execCommand`. ProseMirror is the only mature option in that class. Tiptap is a thin
extension layer on top; we keep direct access to ProseMirror APIs and drop to them freely.
Known gap: ProseMirror has no page-flow layout, so true WYSIWYG pagination is a post-MVP
problem (MVP renders a continuous page-styled view with approximate page boundaries).

**React 19 + TypeScript strict.** Largest ecosystem, and Tiptap's React bindings are
first-class. `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
because the OOXML layer manipulates deeply optional structures where a silent `undefined`
becomes a corrupted document.

**Zustand over Redux.** The app state is small (document metadata, UI state, settings);
the document itself lives in the ProseMirror state, not in the store. Redux's ceremony
buys nothing here.

**Tailwind 4 + CSS variables.** Tokens live in `src/styles/tokens.css` as CSS variables so
theme switching is a single attribute flip with no re-render; Tailwind consumes them via
`@theme inline`. Colors are never hardcoded in components.

**pnpm.** Strict node_modules layout catches phantom dependencies, which matters when the
OOXML layer pulls in a deep tree.

## Consequences

- Two toolchains to keep green in CI: Node 22+ and Rust stable.
- Webview differences across OSes must be caught by e2e on all three platforms
  (Update 1), not assumed away.
- Any OS-specific code goes behind `src/platform/` — nowhere else.
- Swapping any row of the table above requires a new ADR.
