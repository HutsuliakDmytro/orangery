import { useCallback, useSyncExternalStore } from 'react'
import { formatShortcut } from '@orangery/platform'
import { getCommand, isCommandActive, isCommandEnabled } from './registry'
import { useCommandSource } from './source'
import type { Command, CommandContext } from './types'

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
 * The two booleans packed into one number.
 *
 * `useSyncExternalStore` compares snapshots by identity, so returning an object
 * would re-render on every notification whether or not anything changed. A
 * number only differs when one of the flags does.
 */
const ACTIVE = 1
const ENABLED = 2

function snapshotOf(command: Command | undefined, context: CommandContext | null): number {
  if (!command || context === null) return 0
  return (
    (isCommandActive(command, context) ? ACTIVE : 0) |
    (isCommandEnabled(command, context) ? ENABLED : 0)
  )
}

const noSubscription = () => () => {}

/**
 * Binds one registry command to a React surface (toolbar button, menu item,
 * palette row). Recomputes only this command's state, so a button re-renders
 * when its own active/enabled value changes — not on every keystroke.
 */
export function useCommand(id: string): UseCommandResult {
  const source = useCommandSource()
  const command = getCommand(id)

  const subscribe = source?.subscribe ?? noSubscription
  const getSnapshot = useCallback(
    () => snapshotOf(command, source?.read() ?? null),
    [command, source],
  )
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const run = useCallback(() => {
    const context = source?.read() ?? null
    if (!command || context === null) return
    if (!isCommandEnabled(command, context)) return
    command.run(context)
  }, [command, source])

  return {
    command,
    label: command?.label ?? id,
    shortcut: command?.shortcut ? formatShortcut(command.shortcut) : null,
    isActive: (state & ACTIVE) !== 0,
    isEnabled: (state & ENABLED) !== 0,
    run,
  }
}
