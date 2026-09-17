/**
 * The chrome, and the registry every part of it reads from.
 *
 * Menus, toolbar, palette and context menus all render whatever is registered,
 * which is what keeps one action from having three implementations that drift
 * apart — see `apps/docs/docs/adr/0002-command-registry.md`. The registry
 * itself knows nothing about documents or decks: an app registers its commands
 * and the chrome follows.
 *
 * Theme tokens ship alongside as `@orangery/ui-kit/tokens.css`.
 */

export {
  allCommands,
  commandsInGroup,
  describeCommands,
  getCommand,
  groupedCommands,
  isCommandActive,
  isCommandEnabled,
  register,
  registerAll,
  resetRegistry,
  runCommand,
} from './commands/registry'
export { COMMAND_GROUPS } from './commands/types'
export type { Command, CommandContext, CommandDescriptor, CommandGroup } from './commands/types'
export { CommandKeymap, toKeymapBinding } from './commands/keymap'
export { searchCommands } from './commands/search'
export type { SearchHit } from './commands/search'
export { useCommand } from './commands/use-command'
export type { UseCommandResult } from './commands/use-command'

export {
  contrastingText,
  DEFAULT_TEXT_COLOR,
  GREYSCALE,
  HIGHLIGHT_COLORS,
  HUES,
  isValidHex,
  normalizeHex,
  TEXT_COLOR_SWATCHES,
} from './colors'

export { ColorPicker } from './components/color-picker'
export { CommandPalette } from './components/command-palette'
export { ConfirmDialog } from './components/confirm-dialog'
export type { ConfirmChoice } from './components/confirm-dialog'
export { PickerPopover } from './components/picker-popover'
export { ToolbarButton, ToolbarSeparator } from './components/toolbar-button'
export { useRovingFocus } from './components/use-roving-focus'
