import { beforeEach, describe, expect, it } from 'vitest'
import { describeCommands, resetRegistry } from '@orangery/ui-kit'
import { blankWorkbook } from '../document/new'
import { openWorkbook } from '../document/workbook'
import { useWorkbookStore } from '../store/workbook-store'
import { registerBuiltinCommands } from './definitions'

/**
 * What the native menu bar is told about this app's commands.
 *
 * `describeCommands` is the payload: the same call the menu sync makes, and
 * the same `isEnabled` every toolbar button asks. The bug it is written
 * against had the bar showing the state the window opened with — everything
 * greyed, because nothing was open yet — while the shortcuts ran fine.
 *
 * So two things are asserted, and the second is the one that broke: a command
 * that needs a workbook is disabled before there is one, and **enabled after**.
 */

const state = (id: string): boolean | undefined =>
  describeCommands({}).find((command) => command.id === id)?.enabled

beforeEach(() => {
  resetRegistry()
  registerBuiltinCommands()
  useWorkbookStore.setState({ open: null })
})

describe('what the menu bar is told', () => {
  it('disables what needs a workbook while there is none', () => {
    expect(state('edit.copy')).toBe(false)
    expect(state('edit.paste')).toBe(false)
  })

  it('enables them the moment a workbook is open', async () => {
    useWorkbookStore.setState({ open: await openWorkbook(await blankWorkbook()) })

    expect(state('edit.copy')).toBe(true)
    expect(state('edit.paste')).toBe(true)
  })

  it('describes every command, whether or not it can be run', async () => {
    // The menu bar is built from this list: a command missing from it is a
    // menu item that does not exist, which is a different bug from a greyed
    // one and just as confusing.
    const before = describeCommands({}).length
    useWorkbookStore.setState({ open: await openWorkbook(await blankWorkbook()) })

    expect(describeCommands({})).toHaveLength(before)
  })
})
