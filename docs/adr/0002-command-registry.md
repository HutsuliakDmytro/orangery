# 0002 — Command registry as the single source of truth for actions

- Status: accepted
- Date: 2026-09-16

## Context

Every user-facing action in a word processor is reachable from at least four places:
the native menu bar, the toolbar, a keyboard shortcut, and the command palette. Word and
Docs both have actions that behave inconsistently between these surfaces — a menu item
that stays enabled when the toolbar button is greyed out, a shortcut that skips the
undo-grouping the menu item applies.

The naive implementation duplicates the logic: the toolbar button calls
`editor.chain().toggleBold().run()`, the menu handler calls it again, the keymap a third
time. Enabled and active state then has to be recomputed independently in each place, and
they drift.

A further constraint is platform-specific: the macOS menu bar is native (built in Rust,
owned by Tauri), so it cannot call a JS closure directly. Whatever the menu shows must be
describable as data that crosses the Rust/JS boundary.

## Decision

A single registry in `src/editor/commands/registry.ts` owns every action as data:

```ts
interface Command {
  id: CommandId
  label: string
  group: CommandGroup // which menu it belongs to
  shortcut?: Shortcut // written with `Mod`, never `Cmd`
  keywords?: string[] // palette search only
  run(ctx: CommandContext): void
  isActive?(ctx: CommandContext): boolean
  isEnabled?(ctx: CommandContext): boolean
}
```

- `CommandContext` carries the Tiptap `Editor`; commands never reach for a global.
- Every surface is a _projection_ of the registry:
  - Toolbar and palette read it through `useCommand(id)`.
  - Tiptap keymaps are generated from `shortcut`.
  - The native menu is generated from a serialisable descriptor list (id, label, shortcut,
    enabled) sent to Rust; Rust emits the id back and the frontend dispatches it through
    the same `run`.
- Only `registry.ts` knows how a command is implemented. Nothing else calls
  `editor.chain()` for a registered action.

Reactivity uses Tiptap's `useEditorState` with a per-command selector, so a toolbar button
re-renders only when _its own_ active/enabled value changes, not on every keystroke — this
matters for the 100+ page responsiveness budget in CLAUDE.md.

## Alternatives considered

**Tiptap extensions own their keymaps, UI calls commands directly.** This is the default
Tiptap pattern and it is what causes the drift above: the shortcut lives in the extension,
the label in the toolbar, the enabled state in both. Rejected.

**Redux-style action objects dispatched to a reducer.** Adds an indirection layer without
solving the real problem (state is in the ProseMirror document, not in a store) and
contradicts the Zustand decision in 0001. Rejected.

## Consequences

- Adding a feature means adding one registry entry; forgetting a surface becomes
  impossible because there is only one.
- A registry test enforces the invariants: no command without a label, no duplicate id, no
  two commands claiming the same shortcut. Shortcut collisions become a failing test
  rather than a bug report.
- The native menu needs a serialisation step (descriptors down, ids up). That indirection
  is the price of a native menu bar and is contained in `src/app/menu/`.
- Commands that need arguments (font size, colour) take them from the context, not from
  `run(arg)` — parameterised actions are modelled as a command that opens a picker plus a
  non-registered internal helper.
