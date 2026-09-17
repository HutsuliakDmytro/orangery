import { beforeEach, describe, expect, it } from 'vitest'
import {
  commandsInGroup,
  describeCommands,
  getCommand,
  groupedCommands,
  register,
  registerAll,
  resetRegistry,
} from './registry'
import type { Command, CommandContext } from './types'

// The registry never touches the editor unless a command's own callback does, so a
// stub is enough to exercise registration, ordering and descriptor serialisation.
const stubContext = { editor: {} } as CommandContext

function makeCommand(overrides: Partial<Command> & Pick<Command, 'id'>): Command {
  return {
    label: `Label for ${overrides.id}`,
    group: 'edit',
    run: () => {},
    ...overrides,
  }
}

describe('registry mechanics', () => {
  beforeEach(resetRegistry)

  it('registers and retrieves a command', () => {
    const command = register(makeCommand({ id: 'test.one' }))
    expect(getCommand('test.one')).toBe(command)
  })

  it('rejects a duplicate id', () => {
    register(makeCommand({ id: 'test.dup' }))
    expect(() => register(makeCommand({ id: 'test.dup' }))).toThrow(/Duplicate command id/)
  })

  it('preserves registration order within a group', () => {
    registerAll([
      makeCommand({ id: 'test.a' }),
      makeCommand({ id: 'test.b' }),
      makeCommand({ id: 'test.c' }),
    ])
    expect(commandsInGroup('edit').map((c) => c.id)).toEqual(['test.a', 'test.b', 'test.c'])
  })

  it('orders groups as declared and skips empty ones', () => {
    registerAll([
      makeCommand({ id: 'test.view', group: 'view' }),
      makeCommand({ id: 'test.file', group: 'file' }),
    ])
    expect(groupedCommands().map((entry) => entry.group)).toEqual(['file', 'view'])
  })

  it('defaults isActive to false and isEnabled to true', () => {
    register(makeCommand({ id: 'test.defaults' }))
    const [descriptor] = describeCommands(stubContext)
    expect(descriptor?.enabled).toBe(true)
  })

  it('serialises Mod to the platform modifier for the native menu', () => {
    register(makeCommand({ id: 'test.shortcut', shortcut: 'Mod+Shift+P' }))
    const [descriptor] = describeCommands(stubContext)
    expect(descriptor?.shortcut).toMatch(/^(Cmd|Ctrl)\+Shift\+P$/)
  })
})
