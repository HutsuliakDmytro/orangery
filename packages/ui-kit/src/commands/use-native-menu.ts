import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'
import { isTauri } from '@orangery/platform'
import { describeCommands, runCommand } from './registry'
import { useCommandSource } from './source'

/**
 * Keeps the native menu bar in sync with the command registry.
 *
 * Descriptors go down to Rust, clicked ids come back up, and the command runs
 * through the same `runCommand` the toolbar and the palette use — see
 * `apps/docs/docs/adr/0002-command-registry.md`.
 *
 * The rebuild is deferred rather than run per change. Describing every command
 * costs a couple of milliseconds on a large document, and the source notifies
 * on every keystroke; nobody reads the menu bar mid-word, so it is brought up
 * to date once typing pauses.
 */
export const MENU_SYNC_DELAY_MS = 250

export function useNativeMenu(): void {
  const source = useCommandSource()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef<string>('')

  useEffect(() => {
    if (!source || !isTauri()) return

    const sync = () => {
      const context = source.read()
      if (context === null) return

      const descriptors = describeCommands(context)
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
    const unsubscribe = source.subscribe(schedule)

    return () => {
      unsubscribe()
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [source])

  useEffect(() => {
    if (!source || !isTauri()) return

    const unlisten = listen<string>('menu:command', (event) => {
      const context = source.read()
      if (context === null) return
      runCommand(event.payload, context)
    })

    return () => {
      void unlisten.then((stop) => {
        stop()
      })
    }
  }, [source])
}
