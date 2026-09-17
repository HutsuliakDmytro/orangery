import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { allCommands, isCommandEnabled } from './registry'
import type { CommandContext } from './types'
import type { Shortcut } from '@orangery/platform'

/**
 * Converts a registry shortcut to prosemirror-keymap syntax:
 * `Mod+Shift+z` → `Mod-Shift-z`. `Mod` is understood by prosemirror-keymap
 * directly, so no platform branching is needed here.
 */
export function toKeymapBinding(shortcut: Shortcut): string {
  return shortcut.split('+').join('-')
}

/**
 * Binds every registered command's shortcut. Runs at high priority so registry
 * bindings win over the defaults StarterKit installs — the registry is the source
 * of truth (see `docs/adr/0002-command-registry.md`).
 */
export interface CommandKeymapOptions {
  /**
   * How to build the context a command runs against, given the editor the
   * keystroke arrived in.
   *
   * Supplied by the app: in a document that is the editor itself, in a deck it
   * is the deck plus the text box the editor belongs to. There is no sensible
   * default, so a keymap configured without one binds nothing rather than
   * running commands against a context it invented.
   */
  context: ((editor: Editor) => CommandContext) | null
}

export const CommandKeymap = Extension.create<CommandKeymapOptions>({
  name: 'commandKeymap',
  priority: 1000,

  addOptions() {
    return { context: null }
  },

  addKeyboardShortcuts() {
    const bindings: Record<string, () => boolean> = {}
    const build = this.options.context
    if (!build) return bindings

    for (const command of allCommands()) {
      if (!command.shortcut) continue
      bindings[toKeymapBinding(command.shortcut)] = () => {
        const ctx = build(this.editor)
        // Returning false lets the key fall through to the next handler.
        if (!isCommandEnabled(command, ctx)) return false
        command.run(ctx)
        return true
      }
    }

    return bindings
  },
})
