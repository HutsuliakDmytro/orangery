import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { useCallback } from 'react'
import { formatShortcut } from '@orangery/platform'
import { getCommand, isCommandActive, isCommandEnabled } from './registry'
import type { Command } from './types'

export interface UseCommandResult {
  /** Undefined only when the id is not registered — a bug, surfaced rather than hidden. */
  command: Command | undefined
  label: string
  /** Platform-formatted for display: `⌘B` on macOS, `Ctrl+B` elsewhere. */
  shortcut: string | null
  isActive: boolean
  isEnabled: boolean
  run: () => void
}

/**
 * Binds one registry command to a React surface (toolbar button, menu item,
 * palette row). The selector recomputes only this command's state, so a button
 * re-renders when its own active/enabled value changes — not on every keystroke.
 */
export function useCommand(id: string): UseCommandResult {
  const { editor } = useCurrentEditor()
  const command = getCommand(id)

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current || !command) return { isActive: false, isEnabled: false }
      const ctx = { editor: current }
      return {
        isActive: isCommandActive(command, ctx),
        isEnabled: isCommandEnabled(command, ctx),
      }
    },
  })

  const run = useCallback(() => {
    if (!editor || !command) return
    const ctx = { editor }
    if (!isCommandEnabled(command, ctx)) return
    command.run(ctx)
  }, [editor, command])

  return {
    command,
    label: command?.label ?? id,
    shortcut: command?.shortcut ? formatShortcut(command.shortcut) : null,
    isActive: state?.isActive ?? false,
    isEnabled: state?.isEnabled ?? false,
    run,
  }
}
