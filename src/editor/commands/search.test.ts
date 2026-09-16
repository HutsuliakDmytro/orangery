import { describe, expect, it } from 'vitest'
import { searchCommands } from './search'
import type { Command } from './types'

function command(id: string, label: string, keywords?: string[]): Command {
  return { id, label, group: 'edit', run: () => {}, ...(keywords ? { keywords } : {}) }
}

const commands = [
  command('edit.undo', 'Undo', ['revert']),
  command('format.bold', 'Bold'),
  command('insert.page-break', 'Page Break'),
  command('format.clear', 'Clear Formatting'),
]

describe('searchCommands', () => {
  it('returns everything for an empty query', () => {
    expect(searchCommands(commands, '  ')).toHaveLength(commands.length)
  })

  it('matches a prefix', () => {
    expect(searchCommands(commands, 'bo')[0]?.command.id).toBe('format.bold')
  })

  it('matches a subsequence across words', () => {
    expect(searchCommands(commands, 'pgbr')[0]?.command.id).toBe('insert.page-break')
  })

  it('ranks word-start matches above scattered ones', () => {
    const [first] = searchCommands(commands, 'cf')
    expect(first?.command.id).toBe('format.clear')
  })

  it('falls back to keywords when the label does not match', () => {
    const hits = searchCommands(commands, 'revert')
    expect(hits.map((hit) => hit.command.id)).toContain('edit.undo')
  })

  it('drops commands that match nothing', () => {
    expect(searchCommands(commands, 'zzz')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(searchCommands(commands, 'BOLD')[0]?.command.id).toBe('format.bold')
  })
})
