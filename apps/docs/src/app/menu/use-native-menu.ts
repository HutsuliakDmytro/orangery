import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { describeCommands, runCommand } from '../../editor/commands'
import { isTauri } from '@orangery/platform'

/**
 * Keeps the native menu bar in sync with the command registry.
 *
 * Descriptors go down to Rust, clicked ids come back up, and the command runs
 * through the same `runCommand` the toolbar and palette use — see
 * `docs/adr/0002-command-registry.md`.
 *
 * The rebuild is deferred rather than run per transaction. `useEditorState`
 * evaluates its selector on every keystroke — its equality check only prevents
 * the re-render, not the work — and describing every command costs a couple of
 * milliseconds on a large document. Nobody reads the menu bar mid-word, so it is
 * brought up to date once typing pauses.
 */
export const MENU_SYNC_DELAY_MS = 250

export function useNativeMenu(): void {
  const { editor } = useCurrentEditor()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef<string>('')

  useEffect(() => {
    if (!editor || !isTauri()) return

    const sync = () => {
      const descriptors = describeCommands({ editor })
      const serialised = JSON.stringify(descriptors)

      // Rust rebuilds the whole menu bar on each call, which flickers on macOS;
      // skipping an identical payload keeps that to actual state changes.
      if (serialised === lastSent.current) return
      lastSent.current = serialised

      void invoke('set_command_menu', { descriptors }).catch((error: unknown) => {
        console.error('failed to update the native menu', error)
      })
    }

    const schedule = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(sync, MENU_SYNC_DELAY_MS)
    }

    sync()

    // Selection changes matter too: enabled-state follows the cursor.
    editor.on('update', schedule)
    editor.on('selectionUpdate', schedule)

    return () => {
      editor.off('update', schedule)
      editor.off('selectionUpdate', schedule)
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [editor])

  useEffect(() => {
    if (!editor || !isTauri()) return

    const unlisten = listen<string>('menu:command', (event) => {
      runCommand(event.payload, { editor })
    })

    return () => {
      void unlisten.then((stop) => {
        stop()
      })
    }
  }, [editor])
}
