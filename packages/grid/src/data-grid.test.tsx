import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataGrid, columnName } from './data-grid'
import type { CellStyle } from './cell-style'
import { recorded } from './test-setup'

/**
 * The grid, as a person meets it.
 *
 * What is drawn is asserted through the recording canvas — the cells are paint,
 * not elements, so there is nothing else to ask. What is typed is asserted
 * through the one real element there is: the input over the cell being edited.
 */

const values = [
  ['Q1', '10.5', '7.1'],
  ['Q2', '14.2', '8.4'],
  ['Q3', '9.8', '8.9'],
]

const grid = (props: Partial<React.ComponentProps<typeof DataGrid>> = {}) =>
  render(
    <DataGrid
      rows={3}
      columns={3}
      label="Chart data"
      width={340}
      height={220}
      valueAt={({ row, column }) => values[row]?.[column] ?? null}
      {...props}
    />,
  )

const drawn = () => recorded.texts.map((one) => one.text)

beforeEach(() => {
  recorded.reset()
})

describe('what it draws', () => {
  it('paints the value of every visible cell', () => {
    grid()
    expect(drawn()).toEqual(expect.arrayContaining(['Q1', '10.5', '8.9']))
  })

  it('paints the letters and the numbers around them', () => {
    grid()
    expect(drawn()).toEqual(expect.arrayContaining(['A', 'B', 'C', '1', '2', '3']))
  })

  it('paints nothing for a blank cell, which is not a nought', () => {
    grid({ valueAt: () => null })
    expect(drawn().filter((text) => text === '0')).toHaveLength(0)
  })

  it('marks the selected cell, and only one of them', () => {
    grid()
    expect(recorded.strokedRects).toHaveLength(1)
  })

  it('names its columns as a spreadsheet does, past Z as well', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
  })

  it('takes the names the caller gives instead, which is what a chart wants', () => {
    grid({ columnHeader: (column) => ['Category', 'Revenue', 'Costs'][column] ?? '' })
    expect(drawn()).toEqual(expect.arrayContaining(['Category', 'Revenue']))
  })
})

describe('moving about', () => {
  it('follows the arrow keys', async () => {
    const user = userEvent.setup()
    grid()

    await user.click(screen.getByRole('grid'))
    recorded.reset()
    await user.keyboard('{ArrowDown}{ArrowRight}')

    // The selection is drawn one row down and one column across from A1.
    const rect = recorded.strokedRects[recorded.strokedRects.length - 1]
    expect(rect).toMatchObject({ x: 44 + 84, y: 22 + 22 })
  })

  it('stops at the edges rather than running off them', async () => {
    const user = userEvent.setup()
    grid()

    await user.click(screen.getByRole('grid'))
    recorded.reset()
    await user.keyboard('{ArrowUp}{ArrowLeft}')

    const rect = recorded.strokedRects[recorded.strokedRects.length - 1]
    expect(rect).toMatchObject({ x: 44, y: 22 })
  })

  it('says where it is for a reader who cannot see the paint', async () => {
    const user = userEvent.setup()
    grid()

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('grid').textContent).toContain('A, row 2: Q2')
  })
})

describe('editing a cell', () => {
  it('opens on F2 with what the cell holds', async () => {
    const user = userEvent.setup()
    grid({ onChange: vi.fn() })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{F2}')

    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Q1')
  })

  it('starts from the first keystroke, replacing what was there', async () => {
    // Every spreadsheet does this, and the keystroke that starts it is the
    // first character rather than a lost one.
    const user = userEvent.setup()
    grid({ onChange: vi.fn() })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('7')

    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('7')
  })

  it('hands the text over on Enter and moves down', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('42{Enter}')

    expect(changed).toHaveBeenCalledWith({ row: 0, column: 0 }, '42')
    expect(screen.getByRole('grid').textContent).toContain('A, row 2:')
  })

  it('throws the edit away on Escape', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('99{Escape}')

    expect(changed).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('commits on Tab and moves across', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('5{Tab}')

    expect(changed).toHaveBeenCalledWith({ row: 0, column: 0 }, '5')
    expect(screen.getByRole('grid').textContent).toContain('B, row 1:')
  })

  it('refuses to edit a cell the caller holds back', async () => {
    const user = userEvent.setup()
    grid({ onChange: () => undefined, editable: ({ column }) => column > 0 })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{F2}')

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('edits nothing at all when nobody is listening', async () => {
    const user = userEvent.setup()
    grid()

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{F2}')

    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('finishing an edit', () => {
  it('hands the text over once, not once per way of leaving the cell', async () => {
    // Enter takes the focus back to the grid, and blurring the input is what
    // commits it — so a grid that did not notice would report one edit twice,
    // and a caller writing into an undo history would record two.
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('7{Enter}')

    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('still commits when the cell is left by clicking away', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('7')
    await user.click(document.body)

    expect(changed).toHaveBeenCalledWith({ row: 0, column: 0 }, '7')
  })

  it('commits once when the cell is left by Tab', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('7{Tab}')

    expect(changed).toHaveBeenCalledTimes(1)
  })
})

describe('emptying a cell', () => {
  it('hands over empty text on Delete, as every spreadsheet does', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{Delete}')

    expect(changed).toHaveBeenCalledWith({ row: 0, column: 0 }, '')
  })

  it('does the same on Backspace, which is the other habit', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{Backspace}')

    expect(changed).toHaveBeenCalledWith({ row: 0, column: 0 }, '')
  })

  it('says nothing about a cell that is already empty', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed, valueAt: () => null })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{Delete}')

    expect(changed).not.toHaveBeenCalled()
  })

  it('leaves a cell the caller holds back alone', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    grid({ onChange: changed, editable: () => false })

    await user.click(screen.getByRole('grid'))
    await user.keyboard('{Delete}')

    expect(changed).not.toHaveBeenCalled()
  })
})

describe('what a cell looks like', () => {
  const styled = (style: CellStyle) =>
    grid({
      styleAt: ({ row, column }) => (row === 0 && column === 0 ? style : null),
    })

  it('fills the background the style asks for', () => {
    styled({ background: '#FFF2CC' })

    const fill = recorded.fills.find((one) => one.style === '#FFF2CC')
    expect(fill).toMatchObject({ x: 44, y: 22 })
  })

  it('draws the text in the font and colour the style states', () => {
    styled({ font: 'bold 14px Calibri', color: '#9C0006' })

    const drawnCell = recorded.texts.find((one) => one.text === 'Q1')
    expect(drawnCell?.font).toBe('bold 14px Calibri')
  })

  it('puts numbers on the right and words on the left, unasked', () => {
    // The oldest convention in spreadsheets: the digits line up under each
    // other, and a number that landed in a text cell shows on the wrong side.
    grid()

    expect(recorded.texts.find((one) => one.text === 'Q1')?.align).toBe('left')
    expect(recorded.texts.find((one) => one.text === '10.5')?.align).toBe('right')
  })

  it('follows the file where the file states an alignment', () => {
    styled({ align: 'center' })
    expect(recorded.texts.find((one) => one.text === 'Q1')?.align).toBe('center')
  })

  it('draws the lines a cell states around itself', () => {
    styled({ borders: { left: null, right: null, top: null, bottom: '#FF0000' } })

    expect(recorded.lines.some((line) => line.style === '#FF0000')).toBe(true)
  })
})

describe('cells merged into one', () => {
  const merged = () =>
    grid({
      columns: 3,
      mergeAt: ({ row, column }) =>
        row === 0 && column <= 1 ? { cell: { row: 0, column: 0 }, rows: 1, columns: 2 } : null,
      styleAt: ({ row, column }) => (row === 0 && column === 0 ? { background: '#DDEEFF' } : null),
    })

  it('draws the corner across the whole range', () => {
    merged()

    // Two columns of 84 make one box of 168.
    expect(recorded.fills.find((one) => one.style === '#DDEEFF')?.width).toBe(168)
  })

  it('draws nothing for the cells the merge swallowed', () => {
    merged()

    // The corner's text is drawn once; the cell beside it draws nothing, or
    // the text would be clipped by a box it was merged with.
    expect(recorded.texts.filter((one) => one.text === '10.5')).toHaveLength(0)
  })
})

describe('rows and columns held still', () => {
  const frozen = () =>
    grid({
      rows: 3,
      columns: 3,
      frozen: { rows: 1, columns: 1 },
    })

  it('draws the held rows as well as the scrolled ones', () => {
    frozen()
    expect(recorded.texts.some((one) => one.text === 'Q1')).toBe(true)
  })

  it('marks where the held strip ends', () => {
    frozen()

    // Without the line, the first rows look like the rows somebody scrolled
    // to rather than the ones that will not move.
    expect(recorded.lines.some((line) => line.style === '#666666')).toBe(true)
  })
})
