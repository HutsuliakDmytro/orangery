import { resolveShortcut } from '../../platform/keys'
import type { Command, CommandContext, CommandDescriptor, CommandGroup } from './types'
import { COMMAND_GROUPS } from './types'

/**
 * The single source of truth for user-facing actions.
 *
 * Menus, toolbar, keymaps and the command palette are all projections of this map —
 * see `docs/adr/0002-command-registry.md`. Nothing outside a command's own `run`
 * should call `editor.chain()` for a registered action.
 */

const registry = new Map<string, Command>()

/** Registration order inside a group is preserved and drives menu ordering. */
export function register(command: Command): Command {
  if (registry.has(command.id)) {
    throw new Error(`Duplicate command id: ${command.id}`)
  }
  registry.set(command.id, command)
  return command
}

export function registerAll(commands: readonly Command[]): void {
  for (const command of commands) register(command)
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

export function allCommands(): Command[] {
  return [...registry.values()]
}

export function commandsInGroup(group: CommandGroup): Command[] {
  return allCommands().filter((command) => command.group === group)
}

/** Groups in menu-bar order, skipping groups with no commands. */
export function groupedCommands(): { group: CommandGroup; commands: Command[] }[] {
  return COMMAND_GROUPS.map((group) => ({ group, commands: commandsInGroup(group) })).filter(
    (entry) => entry.commands.length > 0,
  )
}

export function isCommandActive(command: Command, ctx: CommandContext): boolean {
  return command.isActive?.(ctx) ?? false
}

export function isCommandEnabled(command: Command, ctx: CommandContext): boolean {
  return command.isEnabled?.(ctx) ?? true
}

/** Runs a command by id. No-op when the command is unknown or disabled. */
export function runCommand(id: string, ctx: CommandContext): boolean {
  const command = registry.get(id)
  if (!command || !isCommandEnabled(command, ctx)) return false
  command.run(ctx)
  return true
}

/** Snapshot for the native menu bar. Crosses the Rust boundary, so it must stay plain. */
export function describeCommands(ctx: CommandContext): CommandDescriptor[] {
  return allCommands().map((command) => ({
    id: command.id,
    label: command.label,
    group: command.group,
    shortcut: command.shortcut ? resolveShortcut(command.shortcut) : null,
    enabled: isCommandEnabled(command, ctx),
  }))
}

/** Test-only: drops every registration so suites start from a clean map. */
export function resetRegistry(): void {
  registry.clear()
}
