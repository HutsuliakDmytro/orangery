import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { openWorkbook } from '../document/workbook'
import type { OpenWorkbook } from '../document/workbook'
import { SheetTabs } from './sheet-tabs'

/**
 * The strip of tabs along the bottom.
 *
 * Switching sheets is a click and everything else is behind a right click,
 * so what is tested is that the click still works and that the menu offers
 * the rest — including the one question that has to be asked, since a deleted
 * sheet is not something the history can give back.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook

beforeAll(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
})

const handlers = () => ({
  onSelect: vi.fn(),
  onAdd: vi.fn(),
  onRename: vi.fn(),
  onRemove: vi.fn(),
  onMove: vi.fn(),
  onHide: vi.fn(),
  onColor: vi.fn(),
})

const tabs = (given: Partial<ReturnType<typeof handlers>> = {}) => {
  const called = { ...handlers(), ...given }
  const shown = open.sheets.filter((one) => !one.hidden)

  render(<SheetTabs open={open} sheets={shown} current={0} {...called} />)
  return { ...called, shown }
}

/** A tab, which is the button that says whether it is the current one. */
const tabNamed = (name: string) => screen.getByRole('button', { name })

describe('the strip of tabs', () => {
  it('shows the sheets a person can see, and not the hidden one', () => {
    tabs()

    expect(tabNamed('Budget')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Working' })).toBeNull()
  })

  it('says how many are hidden, and brings one back', async () => {
    const { onHide } = tabs()

    await userEvent.click(screen.getByRole('button', { name: 'Show hidden sheets' }))
    expect(onHide).toHaveBeenCalledWith(expect.any(String), false)
  })

  it('adds a sheet from the plus', async () => {
    const { onAdd } = tabs()

    await userEvent.click(screen.getByRole('button', { name: 'Add sheet' }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('renames a tab that was double-clicked, over the tab itself', async () => {
    const { onRename, shown } = tabs()

    await userEvent.dblClick(tabNamed('Budget'))
    const field = screen.getByRole('textbox', { name: 'Sheet name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Renamed{Enter}')

    expect(onRename).toHaveBeenCalledWith(shown[0]?.path, 'Renamed')
  })

  it('leaves the name alone where the rename was abandoned', async () => {
    const { onRename } = tabs()

    await userEvent.dblClick(tabNamed('Budget'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Sheet name' }), 'x{Escape}')

    expect(onRename).not.toHaveBeenCalled()
  })

  it('opens a menu on a right click', async () => {
    tabs()

    await userEvent.pointer({ keys: '[MouseRight]', target: tabNamed('Budget') })
    expect(screen.getByRole('menu')).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeDefined()
  })

  it('moves a sheet along one place', async () => {
    const { onMove, shown } = tabs()

    await userEvent.pointer({ keys: '[MouseRight]', target: tabNamed('Budget') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move right' }))

    expect(onMove).toHaveBeenCalledWith(shown[0]?.path, 1)
  })

  it('will not move the first sheet further left', async () => {
    tabs()

    await userEvent.pointer({ keys: '[MouseRight]', target: tabNamed('Budget') })
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Move left' }).disabled).toBe(
      true,
    )
  })

  it('puts a colour on a tab', async () => {
    const { onColor, shown } = tabs()

    await userEvent.pointer({ keys: '[MouseRight]', target: tabNamed('Budget') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Orange' }))

    expect(onColor).toHaveBeenCalledWith(shown[0]?.path, 'FFFF7A00')
  })

  it('asks before deleting, because nothing here can be undone', async () => {
    const { onRemove, shown } = tabs()
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await userEvent.pointer({ keys: '[MouseRight]', target: tabNamed('Budget') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(asked).toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith(shown[0]?.path)
    asked.mockRestore()
  })

  it('deletes nothing when the answer is no', async () => {
    const { onRemove } = tabs()
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await userEvent.pointer({ keys: '[MouseRight]', target: tabNamed('Budget') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(onRemove).not.toHaveBeenCalled()
    asked.mockRestore()
  })
})
