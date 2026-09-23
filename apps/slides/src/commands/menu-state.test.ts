import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { describeCommands, resetRegistry } from '@orangery/ui-kit'
import { useDeckStore } from '../store/deck-store'
import { registerBuiltinCommands } from './definitions'

/**
 * What the native menu bar is told about this app's commands.
 *
 * `describeCommands` is the payload the menu sync sends, and `isEnabled` is
 * what every one of these commands answers with. The bug it is written
 * against had the bar showing the state the window opened with — everything
 * greyed, because no deck was open yet — while the shortcuts ran fine.
 *
 * Slides had a second half to that: the command source told the menu about the
 * *view* store and nothing else, while half the commands ask the **deck**
 * store whether there is a deck. Opening one therefore changed every answer
 * and notified nobody.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const state = (id: string): boolean | undefined =>
  describeCommands({}).find((command) => command.id === id)?.enabled

beforeEach(() => {
  resetRegistry()
  registerBuiltinCommands()
  useDeckStore.setState({ open: null, current: -1, error: null })
})

describe('what the menu bar is told', () => {
  it('disables what needs a deck while there is none', () => {
    expect(state('edit.find')).toBe(false)
  })

  it('enables it the moment a deck is open', async () => {
    const bytes = await readFile(join(FIXTURES, 'empty.pptx'))
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/empty.pptx')

    expect(state('edit.find')).toBe(true)
  })
})
