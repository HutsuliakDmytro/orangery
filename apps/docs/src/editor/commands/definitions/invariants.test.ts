import { beforeEach, describe, expect, it } from 'vitest'
import { allCommands, COMMAND_GROUPS, resetRegistry, toKeymapBinding } from '@orangery/ui-kit'
import { registerBuiltinCommands } from './index'

/**
 * Properties of this app's command set, not of the registry that holds it.
 *
 * The registry's own mechanics are tested in `@orangery/ui-kit`; what is here
 * is whether Docs' commands are well formed. The shortcut collision check is
 * the one that earns its place — two commands claiming the same binding is
 * invisible until a user presses it and gets the wrong one.
 */

beforeEach(() => {
  resetRegistry()
})

describe('built-in command invariants', () => {
  beforeEach(registerBuiltinCommands)

  it('registers at least one command', () => {
    expect(allCommands().length).toBeGreaterThan(0)
  })

  it('gives every command a non-empty label', () => {
    const unlabelled = allCommands().filter((command) => command.label.trim() === '')
    expect(unlabelled.map((c) => c.id)).toEqual([])
  })

  it('gives every command a known group', () => {
    const stray = allCommands().filter((command) => !COMMAND_GROUPS.includes(command.group))
    expect(stray.map((c) => c.id)).toEqual([])
  })

  it('uses dot-namespaced ids', () => {
    const malformed = allCommands().filter((command) => !/^[a-z]+(\.[a-z0-9-]+)+$/.test(command.id))
    expect(malformed.map((c) => c.id)).toEqual([])
  })

  it('has no shortcut collisions', () => {
    const seen = new Map<string, string>()
    const collisions: string[] = []

    for (const command of allCommands()) {
      if (!command.shortcut) continue
      const binding = toKeymapBinding(command.shortcut)
      const owner = seen.get(binding)
      if (owner) {
        collisions.push(`${binding}: ${owner} vs ${command.id}`)
        continue
      }
      seen.set(binding, command.id)
    }

    expect(collisions).toEqual([])
  })

  it('writes shortcuts with Mod, never a hardcoded Cmd or Ctrl', () => {
    const hardcoded = allCommands().filter(
      (command) => command.shortcut && /\b(Cmd|Ctrl|Meta)\b/.test(command.shortcut),
    )
    expect(hardcoded.map((c) => c.id)).toEqual([])
  })
})
