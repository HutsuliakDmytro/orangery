import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { resolveStyle } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from '../document/workbook'
import { workbookBytes } from '../document/save'
import { recorded } from '../test-setup'
import { App } from './app'
import { useWorkbookStore } from '../store/workbook-store'

/**
 * The window, with and without a workbook in it.
 *
 * What a reader can do today: open a file, see the sheet it opens on, move
 * between its sheets. Everything here goes through the same doors a person
 * uses — the command registry and the tabs — rather than through the store.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

const load = async () => {
  const bytes = new Uint8Array(await readFile(FIXTURE))
  await act(async () => {
    await useWorkbookStore.getState().load(bytes, '/books/budget.xlsx')
  })
}

beforeEach(() => {
  useWorkbookStore.getState().close()
  recorded.reset()
})

/** Somebody at the keyboard, with the grid under it. */
const atTheGrid = async () => {
  const typist = userEvent.setup()
  await typist.click(await screen.findByRole('grid', { name: 'Budget' }))
  return typist
}

describe('a window with nothing in it', () => {
  it('says so, and offers the one thing there is to do', () => {
    render(<App />)

    expect(screen.getByText('No workbook open')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open a workbook…' })).toBeInTheDocument()
  })

  it('has no tabs, because there are no sheets', () => {
    render(<App />)
    expect(screen.queryByRole('navigation', { name: 'Sheets' })).not.toBeInTheDocument()
  })

  it('cannot open a file without a shell to ask for one', () => {
    // In a browser there is no dialog and no disk, so the command is shown
    // disabled rather than failing when it is chosen.
    render(<App />)
    expect(getCommand('file.open')?.isEnabled?.({})).toBe(false)
  })

  it('cannot save what is not open', () => {
    render(<App />)
    expect(getCommand('file.save')?.isEnabled?.({})).toBe(false)
  })
})

describe('a window with a workbook', () => {
  it('shows the sheet the workbook was left on', async () => {
    render(<App />)
    await load()

    expect(await screen.findByRole('grid', { name: 'Budget' })).toBeInTheDocument()
  })

  it('offers a tab per sheet a person can see', async () => {
    render(<App />)
    await load()

    const tabs = screen.getByRole('navigation', { name: 'Sheets' })

    // The fixture has three sheets and one of them is hidden.
    expect(tabs.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Working' })).not.toBeInTheDocument()
  })

  it('changes sheet when a tab is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    expect(await screen.findByRole('grid', { name: 'Notes' })).toBeInTheDocument()
  })

  it('moves between sheets from the keyboard, through the registry', async () => {
    render(<App />)
    await load()

    act(() => {
      runCommand('sheet.next', {})
    })

    expect(await screen.findByRole('grid', { name: 'Notes' })).toBeInTheDocument()
  })

  it('stops at the last sheet rather than running off the end', async () => {
    render(<App />)
    await load()

    act(() => {
      runCommand('sheet.next', {})
      runCommand('sheet.next', {})
    })

    expect(await screen.findByRole('grid', { name: 'Notes' })).toBeInTheDocument()
  })

  it('closes, leaving the window as it was before', async () => {
    render(<App />)
    await load()

    act(() => {
      runCommand('file.close', {})
    })

    await waitFor(() => {
      expect(screen.getByText('No workbook open')).toBeInTheDocument()
    })
  })
})

describe('a file that will not open', () => {
  it('says what happened and keeps what was open', async () => {
    render(<App />)
    await load()

    act(() => {
      useWorkbookStore.getState().fail('Could not open notes.txt.')
    })

    // The workbook on screen stays: a file that would not open is a reason to
    // say so, not a reason to take away the one being worked on.
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open notes.txt.')
    expect(screen.getByRole('grid', { name: 'Budget' })).toBeInTheDocument()
  })

  it('goes away when it is dismissed', async () => {
    const user = userEvent.setup()
    render(<App />)

    act(() => {
      useWorkbookStore.getState().fail('Could not open notes.txt.')
    })
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the box that says where you are', () => {
  it('shows the cell the cursor is on', async () => {
    render(<App />)
    await load()

    expect(await screen.findByLabelText('Name box')).toHaveValue('A1')
  })

  it('takes you where you type', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'C7{Enter}')

    expect(useWorkbookStore.getState().selection.active).toEqual({ row: 6, column: 2 })
  })

  it('selects a range when given one', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'B2:D5{Enter}')

    await waitFor(() => {
      expect(screen.getByText('12 cells')).toBeInTheDocument()
    })
  })

  it('puts back the old address rather than keeping a wrong one', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'nowhere{Enter}')

    expect(box).toHaveValue('A1')
    expect(useWorkbookStore.getState().selection.active).toEqual({ row: 0, column: 0 })
  })

  it('starts again on the first cell when the sheet changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'C7{Enter}')

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    // A selection belongs to the sheet it was made on.
    expect(await screen.findByLabelText('Name box')).toHaveValue('A1')
  })
})

describe('typing into a sheet', () => {
  it('puts what was typed into the cell, and shows it there', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const grid = await screen.findByRole('grid', { name: 'Budget' })
    await user.click(grid)
    await user.keyboard('Rent{Enter}')

    // A1 held "Month"; it holds what was typed over it now.
    expect(useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(0)?.get(0)?.value).toBe(
      'Rent',
    )
  })

  it('marks the workbook as having changed, which decides what a save does', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    expect(useWorkbookStore.getState().edited).toBe(false)

    await user.click(await screen.findByRole('grid', { name: 'Budget' }))
    await user.keyboard('42{Enter}')

    expect(useWorkbookStore.getState().edited).toBe(true)
  })

  it('redraws the sheet, rather than leaving the old value painted', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    await user.click(await screen.findByRole('grid', { name: 'Budget' }))
    await user.keyboard('Rent{Enter}')

    await waitFor(() => {
      expect(recorded.texts.some((one) => one.text === 'Rent')).toBe(true)
    })
  })
})

describe('taking back what was typed', () => {
  const cellAt = (row: number, column: number) =>
    useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null

  it('is offered only once there is something to take back', async () => {
    render(<App />)
    await load()

    expect(getCommand('edit.undo')?.isEnabled?.({})).toBe(false)

    await (await atTheGrid()).keyboard('42{Enter}')
    expect(getCommand('edit.undo')?.isEnabled?.({})).toBe(true)
  })

  it('puts the cell back as it was', async () => {
    render(<App />)
    await load()

    await (await atTheGrid()).keyboard('Rent{Enter}')
    expect(cellAt(0, 0)?.value).toBe('Rent')

    act(() => {
      runCommand('edit.undo', {})
    })

    // A1 held "Month" as an index into the shared string table.
    expect(cellAt(0, 0)).toMatchObject({ type: 's', value: '0' })
  })

  it('puts it back again on redo', async () => {
    render(<App />)
    await load()

    await (await atTheGrid()).keyboard('Rent{Enter}')
    act(() => {
      runCommand('edit.undo', {})
    })
    act(() => {
      runCommand('edit.redo', {})
    })

    expect(cellAt(0, 0)?.value).toBe('Rent')
  })

  it('clears everything selected, and takes it back in one press', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    // A1 to B2, four cells with something in each. Chosen through the name box
    // rather than by dragging: a click in jsdom lands at the origin, which is
    // the corner box, which selects the whole sheet.
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'A1:B2{Enter}')

    // Delete goes straight to the grid, so no pointer disturbs the selection.
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Budget' }), { key: 'Delete' })

    expect(cellAt(0, 0)).toBeNull()
    expect(cellAt(1, 1)).toBeNull()
    expect(cellAt(0, 1)).toBeNull()

    // C2 was never selected and is still there, which is what says the clear
    // stopped where the selection did.
    expect(cellAt(1, 2)).not.toBeNull()

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(cellAt(0, 0)).not.toBeNull()
    expect(cellAt(1, 1)?.value).toBe('1234.5')
    // One press, for four cells.
    expect(getCommand('edit.undo')?.isEnabled?.({})).toBe(false)
  })
})

describe('filling a block with one value', () => {
  const cellAt = (row: number, column: number) =>
    useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null

  /** Selects a range through the name box, then fills it from the editor. */
  const selectAndType = async (range: string, at: string, text: string) => {
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, `${range}{Enter}`)

    fireEvent.keyDown(screen.getByRole('grid', { name: 'Budget' }), { key: 'F2' })

    // The editor is labelled after the cell it is over, which is what tells it
    // apart from the name box.
    const field = screen.getByLabelText(at)
    fireEvent.change(field, { target: { value: text } })
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })
  }

  it('puts it in every selected cell', async () => {
    render(<App />)
    await load()
    await selectAndType('E8:F9', 'E8', 'Rent')

    expect(cellAt(7, 4)?.value).toBe('Rent')
    expect(cellAt(8, 5)?.value).toBe('Rent')
  })

  it('takes all four back in one press', async () => {
    render(<App />)
    await load()
    await selectAndType('E8:F9', 'E8', 'Rent')

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(cellAt(7, 4)).toBeNull()
    expect(cellAt(8, 5)).toBeNull()
    expect(getCommand('edit.undo')?.isEnabled?.({})).toBe(false)
  })

  it('leaves the cells around it alone', async () => {
    render(<App />)
    await load()
    await selectAndType('E8:F9', 'E8', 'Rent')

    expect(cellAt(7, 6)).toBeNull()
    expect(cellAt(1, 1)?.value).toBe('1234.5')
  })
})

describe('copying cells and putting them back', () => {
  const cellAt = (row: number, column: number) =>
    useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null

  /**
   * What is on the clipboard now.
   *
   * Asked of whatever stub is installed rather than of one the test keeps:
   * `userEvent.setup()` puts its own clipboard on the navigator, so a fake
   * held here would be the one thing nothing ever writes to.
   */
  const onClipboard = () => navigator.clipboard.readText()

  const goTo = async (range: string) => {
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, `${range}{Enter}`)
  }

  it('carries the values somebody was looking at', async () => {
    render(<App />)
    await load()
    await goTo('A1:B2')

    await act(async () => {
      await useWorkbookStore.getState().copy()
    })

    // The header, and the figure as its format shows it rather than as the
    // file keeps it.
    const text = await onClipboard()
    expect(text).toContain('Month')
    expect(text).toContain('1,234.50')
  })

  it('pastes them where the cursor is, as one thing to take back', async () => {
    render(<App />)
    await load()

    await goTo('A1:A2')
    await act(async () => {
      await useWorkbookStore.getState().copy()
    })

    await goTo('E8')
    await act(async () => {
      await useWorkbookStore.getState().paste()
    })

    expect(cellAt(7, 4)?.value).toBe('Month')
    expect(cellAt(8, 4)?.value).toBe('January')

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(cellAt(7, 4)).toBeNull()
    expect(cellAt(8, 4)).toBeNull()
  })

  it('selects what it pasted, which is what somebody acts on next', async () => {
    render(<App />)
    await load()

    await goTo('A1:A2')
    await act(async () => {
      await useWorkbookStore.getState().copy()
    })

    await goTo('E8')
    await act(async () => {
      await useWorkbookStore.getState().paste()
    })

    await waitFor(() => {
      expect(screen.getByText('2 cells')).toBeInTheDocument()
    })
  })

  it('empties the cells a cut took, and only after they are safely copied', async () => {
    render(<App />)
    await load()
    await goTo('A1:A2')

    await act(async () => {
      await useWorkbookStore.getState().cut()
    })

    expect(await onClipboard()).toContain('Month')
    expect(cellAt(0, 0)).toBeNull()
    expect(cellAt(1, 0)).toBeNull()
  })

  it('takes a cut back in one press', async () => {
    render(<App />)
    await load()
    await goTo('A1:A2')

    await act(async () => {
      await useWorkbookStore.getState().cut()
    })
    act(() => {
      runCommand('edit.undo', {})
    })

    expect(cellAt(0, 0)).not.toBeNull()
    expect(cellAt(1, 0)).not.toBeNull()
  })
})

describe('the strip of buttons above the sheet', () => {
  const cellAt = (row: number, column: number) =>
    useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null

  /** What the cell the cursor is on actually looks like, after the cascade. */
  const lookOf = (row: number, column: number) => {
    const open = useWorkbookStore.getState().open
    const styles = open?.styles ?? null
    if (styles === null) throw new Error('the workbook has no styles')

    return resolveStyle(styles, cellAt(row, column)?.style ?? null)
  }

  it('says what the cell under the cursor already is', async () => {
    render(<App />)
    await load()

    // B1 is the header: bold, white on blue.
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'B1{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('bolds what is selected without changing anything else about it', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const before = lookOf(1, 1)
    await typist.click(screen.getByRole('button', { name: 'Bold' }))

    // A1 was a plain header cell; it is bold now and still the same font.
    expect(lookOf(0, 0).font?.bold).toBe(true)
    expect(lookOf(1, 1)).toEqual(before)
  })

  it('formats a whole selection as one thing to take back', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'A1:B2{Enter}')
    await typist.click(screen.getByRole('button', { name: 'Italic' }))

    expect(lookOf(0, 0).font?.italic).toBe(true)
    expect(lookOf(1, 1).font?.italic).toBe(true)

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(lookOf(0, 0).font?.italic).toBe(false)
    expect(lookOf(1, 1).font?.italic).toBe(false)
  })

  it('formats a cell that is not there yet, which is the usual way round', async () => {
    // Making a column a date column before typing a date into it.
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'F9{Enter}')
    await typist.click(screen.getByRole('button', { name: 'Align right' }))

    expect(cellAt(8, 5)?.value).toBeNull()
    expect(lookOf(8, 5).alignment?.horizontal).toBe('right')
  })

  it('carries a new look into the file it saves', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()
    await typist.click(screen.getByRole('button', { name: 'Bold' }))

    const bytes = await workbookBytes(
      useWorkbookStore.getState().open ??
        (() => {
          throw new Error('nothing open')
        })(),
      { edited: true },
    )
    const again = await openWorkbook(bytes)
    const styles = again.styles
    if (styles === null) throw new Error('the saved workbook has no styles')

    const cell = again.sheets[0]?.cells.rows.get(0)?.get(0) ?? null
    expect(resolveStyle(styles, cell?.style ?? null).font?.bold).toBe(true)
  })
})

describe('rows and columns', () => {
  const cellAt = (row: number, column: number) =>
    useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null

  const goTo = async (range: string) => {
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, `${range}{Enter}`)
  }

  it('puts in as many rows as are selected', async () => {
    render(<App />)
    await load()
    await goTo('A2:A4')

    act(() => {
      runCommand('sheet.insertRows', {})
    })

    // What was in row 2 is in row 5 now.
    expect(cellAt(1, 0)).toBeNull()
    expect(cellAt(4, 0)?.value).toBe('2')
  })

  it('takes rows out, and takes the deletion back in one press', async () => {
    render(<App />)
    await load()
    await goTo('A2')

    const before = cellAt(1, 1)?.value
    act(() => {
      runCommand('sheet.deleteRows', {})
    })

    expect(cellAt(1, 1)?.value).not.toBe(before)

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(cellAt(1, 1)?.value).toBe(before)
  })

  it('moves columns across the same way', async () => {
    render(<App />)
    await load()
    await goTo('B1')

    act(() => {
      runCommand('sheet.insertColumns', {})
    })

    expect(cellAt(1, 2)?.value).toBe('1234.5')
  })

  it('is offered only when a workbook is open', () => {
    render(<App />)
    expect(getCommand('sheet.insertRows')?.isEnabled?.({})).toBe(false)
  })
})

describe('hiding and resizing', () => {
  const goTo = async (range: string) => {
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, `${range}{Enter}`)
  }

  const sheetNow = () => useWorkbookStore.getState().open?.sheets[0]

  it('hides the columns that are selected, and brings them back', async () => {
    render(<App />)
    await load()
    await goTo('B1:C1')

    act(() => {
      runCommand('sheet.hideColumns', {})
    })
    expect(sheetNow()?.sheet.columns.filter((one) => one.hidden)).toHaveLength(1)

    act(() => {
      runCommand('sheet.showColumns', {})
    })
    expect(sheetNow()?.sheet.columns.filter((one) => one.hidden)).toHaveLength(0)
  })

  it('hides a row by giving it no height at all', async () => {
    render(<App />)
    await load()
    await goTo('A2')

    act(() => {
      runCommand('sheet.hideRows', {})
    })

    expect(sheetNow()?.cells.properties.get(1)?.hidden).toBe(true)
  })

  it('keeps a width a drag gave a column, all the way into the file', async () => {
    render(<App />)
    await load()

    act(() => {
      useWorkbookStore.getState().resize('column', 1, 1, 30)
    })

    const open = useWorkbookStore.getState().open
    if (open === null) throw new Error('nothing open')

    const again = await openWorkbook(await workbookBytes(open, { edited: true }))

    expect(again.sheets[0]?.sheet.columns.find((one) => one.from === 1)?.width).toBe(30)
  })

  it('leaves the runs of an untouched sheet exactly as they were', async () => {
    render(<App />)
    await load()

    const before = useWorkbookStore.getState().open
    if (before === null) throw new Error('nothing open')

    const again = await openWorkbook(await workbookBytes(before))

    expect(again.sheets[0]?.sheet.columns).toEqual(before.sheets[0]?.sheet.columns)
  })
})

describe('taking back what was not a cell', () => {
  const sheetNow = () => useWorkbookStore.getState().open?.sheets[0]

  it('undoes a drag on a column edge', async () => {
    render(<App />)
    await load()

    const before = sheetNow()?.sheet.columns
    act(() => {
      useWorkbookStore.getState().resize('column', 1, 1, 30)
    })
    expect(sheetNow()?.sheet.columns).not.toEqual(before)

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(sheetNow()?.sheet.columns).toEqual(before)
  })

  it('undoes hiding, rather than the last thing typed', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    await typist.click(await screen.findByRole('grid', { name: 'Budget' }))
    await typist.keyboard('Rent{Enter}')

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'B1{Enter}')
    act(() => {
      runCommand('sheet.hideColumns', {})
    })

    act(() => {
      runCommand('edit.undo', {})
    })

    // The hiding went; what was typed before it stayed.
    expect(sheetNow()?.sheet.columns.filter((one) => one.hidden)).toHaveLength(0)
    expect(sheetNow()?.cells.rows.get(0)?.get(0)?.value).toBe('Rent')
  })
})

describe('the rest of the toolbar', () => {
  const lookOf = (row: number, column: number) => {
    const styles = useWorkbookStore.getState().open?.styles ?? null
    if (styles === null) throw new Error('the workbook has no styles')

    const cell =
      useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null
    return resolveStyle(styles, cell?.style ?? null)
  }

  it('names a font without changing its size', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    // B1 is the header at twelve points.
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'B1{Enter}')
    await typist.selectOptions(screen.getByLabelText('Font'), 'Georgia')

    expect(lookOf(0, 1).font).toMatchObject({ name: 'Georgia', size: 12 })
  })

  it('resizes a font without renaming it', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'B1{Enter}')
    await typist.selectOptions(screen.getByLabelText('Font size'), '18')

    expect(lookOf(0, 1).font).toMatchObject({ name: 'Calibri', size: 18 })
  })

  it('draws a line under the cells that are selected', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'A1:B1{Enter}')
    await typist.selectOptions(screen.getByLabelText('Borders'), 'Bottom border')

    expect(lookOf(0, 0).border.bottom.style).toBe('thin')
    expect(lookOf(0, 1).border.bottom.style).toBe('thin')
    // And nowhere else.
    expect(lookOf(0, 0).border.top.style).toBeNull()
  })

  it('takes every edge away again', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    await typist.selectOptions(screen.getByLabelText('Borders'), 'All borders')
    expect(lookOf(0, 0).border.left.style).toBe('thin')

    await typist.selectOptions(screen.getByLabelText('Borders'), 'No borders')
    expect(lookOf(0, 0).border.left.style).toBeNull()
  })

  it('turns wrapping on for a value with a line break in it', async () => {
    // `Alt+Enter` puts the break in; without wrapping the cell would show the
    // first line and hide the rest, which looks like the break was lost.
    render(<App />)
    await load()

    act(() => {
      useWorkbookStore.getState().edit({ row: 8, column: 5 }, 'one\ntwo')
    })

    expect(lookOf(8, 5).alignment?.wrapText).toBe(true)
  })
})

describe('cells drawn as one', () => {
  const sheetNow = () => useWorkbookStore.getState().open?.sheets[0]
  const cellAt = (row: number, column: number) =>
    sheetNow()?.cells.rows.get(row)?.get(column) ?? null

  const goTo = async (range: string) => {
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, `${range}{Enter}`)
  }

  it('merges what is selected and keeps only the corner’s value', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()
    await goTo('A2:B2')

    // A2 is January, B2 the figure beside it.
    expect(cellAt(1, 1)).not.toBeNull()
    await typist.click(screen.getByRole('button', { name: 'Merge cells' }))

    expect(sheetNow()?.sheet.merges).toHaveLength(2)
    expect(cellAt(1, 0)?.value).toBe('2')
    // Excel discards the rest and says so; keeping a value nobody can see
    // would lose it for good on the next save.
    expect(cellAt(1, 1)).toBeNull()
  })

  it('says so when the cursor is inside one', async () => {
    render(<App />)
    await load()

    // B1 to C1 is merged in the fixture.
    await goTo('C1')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Merge cells' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })

  it('gives the cells back, and takes the whole thing back on undo', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()
    await goTo('B1')

    await typist.click(screen.getByRole('button', { name: 'Merge cells' }))
    expect(sheetNow()?.sheet.merges).toHaveLength(0)

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(sheetNow()?.sheet.merges).toHaveLength(1)
  })

  it('carries a merge into the file it saves', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()
    await goTo('A3:B3')
    await typist.click(screen.getByRole('button', { name: 'Merge cells' }))

    const open = useWorkbookStore.getState().open
    if (open === null) throw new Error('nothing open')

    const again = await openWorkbook(await workbookBytes(open, { edited: true }))
    expect(again.sheets[0]?.sheet.merges).toHaveLength(2)
  })
})

describe('putting a table in order', () => {
  const cellAt = (row: number, column: number) =>
    useWorkbookStore.getState().open?.sheets[0]?.cells.rows.get(row)?.get(column) ?? null

  it('sorts the table the cursor is in, by the column it is in', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'B2{Enter}')

    // B2 is 1234.50 and B3 is -99; A to Z puts the negative first, and the
    // months beside them have to come with them.
    act(() => {
      runCommand('data.sortAscending', {})
    })

    expect(cellAt(1, 1)?.value).toBe('-99')
    expect(cellAt(1, 0)?.value).toBe('3')
  })

  it('leaves the header where it is', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'A2{Enter}')

    act(() => {
      runCommand('data.sortDescending', {})
    })

    // Row 1 is the header and stays; A2 was January and is now the later month.
    expect(cellAt(0, 0)?.value).toBe('0')
  })

  it('takes the whole sort back in one press', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()

    const before = [cellAt(1, 0)?.value, cellAt(2, 0)?.value]
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, 'B2{Enter}')

    act(() => {
      runCommand('data.sortAscending', {})
    })
    act(() => {
      runCommand('edit.undo', {})
    })

    expect([cellAt(1, 0)?.value, cellAt(2, 0)?.value]).toEqual(before)
  })
})

describe('filtering a table', () => {
  const sheetNow = () => useWorkbookStore.getState().open?.sheets[0]
  const hidden = (row: number) => sheetNow()?.cells.properties.get(row)?.hidden ?? false

  const goTo = async (range: string) => {
    const typist = userEvent.setup()
    const box = await screen.findByLabelText('Name box')
    await typist.clear(box)
    await typist.type(box, `${range}{Enter}`)
  }

  it('puts the arrows on the table the cursor is in', async () => {
    render(<App />)
    await load()
    await goTo('A2')

    act(() => {
      runCommand('data.filter', {})
    })

    expect(sheetNow()?.sheet.autoFilter?.range.to).toEqual({ row: 3, column: 2 })
  })

  it('offers the values of a column and hides what is unticked', async () => {
    const typist = userEvent.setup()
    render(<App />)
    await load()
    await goTo('A2')

    act(() => {
      runCommand('data.filter', {})
    })

    // The arrow lives on the header cell, A1.
    const grid = screen.getByRole('grid', { name: 'Budget' })
    const surface = grid.querySelector(':scope > div')
    if (surface === null) throw new Error('the grid has no surface')

    // 44 across for the row numbers, 22 down for the letters; A1 is 140 wide.
    fireEvent.pointerDown(surface, { clientX: 44 + 140 - 8, clientY: 22 + 10 })

    const list = await screen.findByRole('dialog', { name: 'Filter' })
    expect(list).toBeInTheDocument()

    await typist.click(within(list).getByLabelText('January'))
    await typist.click(within(list).getByText('Apply'))

    expect(hidden(1)).toBe(true)
    expect(hidden(2)).toBe(false)
  })

  it('carries a filter into the file it saves', async () => {
    render(<App />)
    await load()
    await goTo('A2')

    act(() => {
      runCommand('data.filter', {})
    })

    const open = useWorkbookStore.getState().open
    if (open === null) throw new Error('nothing open')

    const again = await openWorkbook(await workbookBytes(open, { edited: true }))
    expect(again.sheets[0]?.sheet.autoFilter?.range.to).toEqual({ row: 3, column: 2 })
  })
})
