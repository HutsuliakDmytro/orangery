import type { Shortcut } from '@orangery/platform'

/**
 * Menu grouping. Also decides the order commands appear in the native menu bar
 * and the section headings in the command palette.
 */
export const COMMAND_GROUPS = ['file', 'edit', 'format', 'insert', 'view', 'help'] as const

export type CommandGroup = (typeof COMMAND_GROUPS)[number]

/**
 * Everything a command is allowed to touch. Commands never reach for globals.
 *
 * Deliberately empty here. Each app says what its commands act on by augmenting
 * this interface — Docs the editor, Slides the deck and what is selected on it:
 *
 * ```ts
 * declare module '@orangery/ui-kit' {
 *   interface CommandContext {
 *     editor: Editor
 *   }
 * }
 * ```
 *
 * It named `editor` until Slides needed a menu. A deck has no editor at all —
 * only a text box inside a shape does — so the type was making one app fake
 * the other's context to use its own registry.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandContext {}

export interface Command {
  /** Stable, dot-namespaced, e.g. `format.bold`. Used as the native menu item id. */
  id: string
  /** Shown in menus, tooltips and the palette. Required — see the registry test. */
  label: string
  group: CommandGroup
  /** Written with `Mod`, never `Cmd`/`Ctrl` — see `src/platform/keys.ts`. */
  shortcut?: Shortcut
  /** Extra search terms for the command palette. */
  keywords?: string[]
  run: (ctx: CommandContext) => void
  /** Toggle state, e.g. bold is on at the cursor. Defaults to `false`. */
  isActive?: (ctx: CommandContext) => boolean
  /** Defaults to `true`. A disabled command is greyed out, not hidden. */
  isEnabled?: (ctx: CommandContext) => boolean
}

/** Serialisable shape sent to Rust to build the native menu. */
export interface CommandDescriptor {
  id: string
  label: string
  group: CommandGroup
  shortcut: string | null
  enabled: boolean
  /**
   * Null for a command that is not a toggle.
   *
   * A toggle shown as a plain menu item gives no way to tell whether it is on,
   * which for something like "keep with next" is the only state there is.
   */
  active: boolean | null
}
