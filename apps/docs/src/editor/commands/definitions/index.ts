import { registerAll, resetRegistry } from '@orangery/ui-kit'
import '../context'
import { appearanceCommands } from './appearance'
import { editCommands } from './edit'
import { fileCommands } from './file'
import { formatCommands } from './format'
import { imageCommands } from './image'
import { insertCommands } from './insert'
import { paragraphCommands } from './paragraph'
import { searchCommandDefinitions } from './search'
import { tableCommands } from './table'
import { viewCommands } from './view'

/**
 * Registers every command exactly once. Called from the editor setup; the reset
 * keeps hot-module reload and repeated test runs from tripping the duplicate-id guard.
 */
export function registerBuiltinCommands(): void {
  resetRegistry()
  registerAll(fileCommands)
  registerAll(editCommands)
  registerAll(formatCommands)
  registerAll(paragraphCommands)
  registerAll(appearanceCommands)
  registerAll(insertCommands)
  registerAll(imageCommands)
  registerAll(searchCommandDefinitions)
  registerAll(tableCommands)
  registerAll(viewCommands)
}
