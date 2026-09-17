import { Extension } from '@tiptap/core'
import { allCommands, isCommandEnabled } from './registry'
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
export const CommandKeymap = Extension.create({
  name: 'commandKeymap',
  priority: 1000,

  addKeyboardShortcuts() {
    const bindings: Record<string, () => boolean> = {}

    for (const command of allCommands()) {
      if (!command.shortcut) continue
      bindings[toKeymapBinding(command.shortcut)] = () => {
        const ctx = { editor: this.editor }
        // Returning false lets the key fall through to the next handler.
        if (!isCommandEnabled(command, ctx)) return false
        command.run(ctx)
        return true
      }
    }

    return bindings
  },
})
