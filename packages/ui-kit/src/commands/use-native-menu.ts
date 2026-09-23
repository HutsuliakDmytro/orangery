import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef } from 'react'
import { isTauri } from '@orangery/platform'
import { describeCommands, runCommand } from './registry'
import type { CommandDescriptor } from './types'
import { useCommandSource } from './source'

/**
 * Keeps the native menu bar in sync with the command registry.
 *
 * Descriptors go down to Rust, clicked ids come back up, and the command runs
 * through the same `runCommand` the toolbar and the palette use — see
 * `apps/docs/docs/adr/0002-command-registry.md`.
 *
 * Two messages rather than one, because they happen at different rates. What
 * the menu bar *is* — which commands, in which order, under which labels and
 * shortcuts — changes when a window opens and almost never after. Whether each
 * of them can be run right now changes with every selection, every keystroke,
 * every document opened. Rebuilding a menu bar for the second is what made the
 * bar blink on macOS, and rebuilding it slowly is what made it stop matching
 * the registry at all.
 *
 * So the shape is sent when the shape changes, and the state — enabled, and
 * whether a toggle is on — is sent on its own, at a rate somebody dragging a
 * selection will not notice.
 */

/**
 * How long to wait before sending a state change.
 *
 * One frame. The menu bar has to be right by the time a pointer reaches it,
 * and a selection dragged across a paragraph is a hundred notifications that
 * want to be one message.
 */
export const MENU_SYNC_DELAY_MS = 16

/** What the menu bar looks like, as far as anything is worth rebuilding for. */
function shapeOf(descriptors: readonly CommandDescriptor[]): string {
  return JSON.stringify(
    descriptors.map((one) => [one.id, one.label, one.group, one.shortcut, one.active !== null]),
  )
}

/** What changes as somebody works, which is the part sent often. */
function stateOf(descriptors: readonly CommandDescriptor[]): string {
  return JSON.stringify(descriptors.map((one) => [one.id, one.enabled, one.active]))
}

/**
 * Calls back when this window comes to the front.
 *
 * A no-op where there is no window to ask — which is every test that says it
 * is running under Tauri without standing up the rest of one.
 */
function watchFocus(onFocused: () => void): Promise<() => void> {
  try {
    return getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) onFocused()
      })
      .catch(() => () => undefined)
  } catch {
    return Promise.resolve(() => undefined)
  }
}

export function useNativeMenu(): void {
  const source = useCommandSource()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shape = useRef<string>('')
  const state = useRef<string>('')

  useEffect(() => {
    if (!source || !isTauri()) return

    /**
     * Sends whichever of the two messages is needed.
     *
     * `force` is for a window that has just been focused: on macOS the menu
     * bar belongs to the application and shows whatever the last window put
     * there, so the one coming forward has to put its own back.
     */
    const sync = async (force = false): Promise<void> => {
      const context = source.read()
      if (context === null) return

      const descriptors = describeCommands(context)
      const built = shapeOf(descriptors)
      const current = stateOf(descriptors)

      if (force || built !== shape.current) {
        await invoke('set_command_menu', { descriptors })
        shape.current = built
        state.current = current
        return
      }

      if (current === state.current) return
      state.current = current

      // `false` means the menu bar is not the one these states are about —
      // the window has not built one yet, or the registry changed shape
      // between the two messages. Descriptors settle it either way.
      const applied = await invoke<boolean>('sync_command_menu', {
        states: descriptors.map((one) => ({
          id: one.id,
          enabled: one.enabled,
          active: one.active,
        })),
      })

      if (!applied) {
        await invoke('set_command_menu', { descriptors })
        shape.current = built
      }
    }

    const report = (error: unknown) => {
      console.error('failed to update the native menu', error)
    }

    const run = (force = false) => {
      sync(force).catch(report)
    }

    const schedule = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        run()
      }, MENU_SYNC_DELAY_MS)
    }

    run()
    const unsubscribe = source.subscribe(schedule)

    // Each window has its own document and its own idea of what can be done to
    // it; the bar on screen belongs to whichever is in front.
    //
    // Reached through a try: `getCurrentWindow` reads the window Tauri
    // injected, and a suite that has said it is running under Tauri without
    // injecting one would otherwise take the whole hook — and the menu — down
    // with it.
    const focus = watchFocus(() => {
      void invoke('focus_command_menu').catch(report)
      run(true)
    })

    return () => {
      unsubscribe()
      if (timer.current !== null) clearTimeout(timer.current)
      void focus.then((stop) => {
        stop()
      })
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
