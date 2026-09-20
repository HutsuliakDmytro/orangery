import { fireEvent, render, screen } from '@testing-library/react'
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

  it('draws them around an empty cell too, which is most of a ruled form', () => {
    grid({
      valueAt: () => null,
      styleAt: () => ({ borders: { left: null, right: null, top: null, bottom: '#FF0000' } }),
    })

    expect(recorded.lines.some((line) => line.style === '#FF0000')).toBe(true)
  })
})

describe('a bar across a cell', () => {
  const barred = (proportion: number) =>
    grid({
      styleAt: ({ row, column }) =>
        row === 0 && column === 1 ? { bar: { color: '#638EC6', proportion } } : null,
    })

  it('fills the share of the cell it was given', () => {
    barred(0.5)

    // A column is 84 wide, less a point at each edge for the gridline.
    expect(recorded.fills.find((one) => one.style === '#638EC6')?.width).toBeCloseTo(41)
  })

  it('leaves the number readable on top of it', () => {
    barred(0.9)
    expect(recorded.texts.some((one) => one.text === '10.5')).toBe(true)
  })

  it('draws nothing for a bar of no length', () => {
    barred(0)
    expect(recorded.fills.some((one) => one.style === '#638EC6')).toBe(false)
  })
})

describe('an icon beside a value', () => {
  const withIcon = (icon: CellStyle['icon']) =>
    grid({ styleAt: ({ row, column }) => (row === 0 && column === 1 ? { icon } : null) })

  it('draws a round shape for a round icon and a cornered one for a flag', () => {
    withIcon({ shape: 'circle', color: '#00B050' })
    expect(recorded.paths.some((one) => one.curved && one.style === '#00B050')).toBe(true)

    recorded.reset()
    withIcon({ shape: 'flag', color: '#FF0000' })
    expect(recorded.paths.some((one) => !one.curved && one.style === '#FF0000')).toBe(true)
  })

  it('points an arrow where it is told', () => {
    /**
     * Where the tip is, from the shape alone.
     *
     * An arrow is a flat tail and a single point at the other end, so the end
     * with one corner to it is the end it points at.
     */
    const tip = (points: [number, number][]) => {
      const heights = points.map(([, y]) => Math.round(y * 100) / 100)
      const top = Math.min(...heights)
      const bottom = Math.max(...heights)
      return heights.filter((y) => y === top).length === 1 ? top : bottom
    }

    withIcon({ shape: 'arrow', color: '#00B050', direction: 'up' })
    const up = recorded.paths.find((one) => one.style === '#00B050')?.points ?? []

    recorded.reset()
    withIcon({ shape: 'arrow', color: '#00B050', direction: 'down' })
    const down = recorded.paths.find((one) => one.style === '#00B050')?.points ?? []

    expect(tip(up)).toBeLessThan(tip(down))
  })

  it('spends the segments a rating has not earned in grey', () => {
    withIcon({ shape: 'bars', color: '#00B050', filled: 2, steps: 4 })

    expect(recorded.fills.filter((one) => one.style === '#00B050')).toHaveLength(2)
    expect(recorded.fills.filter((one) => one.style === '#D4D4D4')).toHaveLength(2)
  })

  it('moves a left-aligned value along to make room for it', () => {
    const without = grid({ valueAt: () => 'Q1' })
    const plain = recorded.texts.find((one) => one.text === 'Q1')?.x ?? 0
    without.unmount()

    recorded.reset()
    grid({ valueAt: () => 'Q1', styleAt: () => ({ icon: { shape: 'circle', color: '#00B050' } }) })
    const moved = recorded.texts.find((one) => one.text === 'Q1')?.x ?? 0

    expect(moved).toBeGreaterThan(plain)
  })

  it('leaves a right-aligned number where it was, at the other end of the cell', () => {
    grid({ valueAt: () => '10.5' })
    const plain = recorded.texts.find((one) => one.text === '10.5')?.x ?? 0

    recorded.reset()
    grid({
      valueAt: () => '10.5',
      styleAt: () => ({ icon: { shape: 'circle', color: '#00B050' } }),
    })

    expect(recorded.texts.find((one) => one.text === '10.5')?.x).toBe(plain)
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

describe('a value that does not fit on one line', () => {
  const long = 'Total expenditure for the quarter'

  it('breaks it into lines that fit the cell', () => {
    grid({ valueAt: () => long, styleAt: () => ({ wrap: true }) })

    const lines = recorded.texts.filter((one) => long.startsWith(one.text.split(' ')[0] ?? '#'))
    expect(lines.length).toBeGreaterThan(1)
  })

  it('leaves it on one line when the cell does not ask for wrapping', () => {
    grid({ valueAt: () => long })

    expect(recorded.texts.some((one) => one.text === long)).toBe(true)
  })

  it('keeps the lines around the middle of the cell, not below it', () => {
    // One wrapped cell in a row should not sit lower than its neighbours.
    grid({ rows: 1, columns: 1, valueAt: () => long, styleAt: () => ({ wrap: true }) })

    const lines = recorded.texts.filter((one) => one.text !== 'A' && one.text !== '1')
    const middle = lines.reduce((sum, one) => sum + one.y, 0) / lines.length

    // The first row's box runs from 22 to 44; its middle is 33.
    expect(middle).toBeCloseTo(33, 0)
  })
})

describe('a value turned on its side', () => {
  it('turns the canvas under it rather than the letters in it', () => {
    grid({ valueAt: () => 'Q1', styleAt: () => ({ rotation: 90 }) })

    const drawnCell = recorded.texts.find((one) => one.text === 'Q1')
    // Anticlockwise in the file is clockwise on a canvas, where y points down.
    expect(drawnCell?.angle).toBeCloseTo(-Math.PI / 2)
  })

  it('stands the letters on end for a stacked cell, each the right way up', () => {
    grid({ valueAt: () => 'Q1', styleAt: () => ({ rotation: 'stacked' }) })

    expect(recorded.texts.some((one) => one.text === 'Q')).toBe(true)
    expect(recorded.texts.some((one) => one.text === '1')).toBe(true)
    expect(recorded.texts.find((one) => one.text === 'Q')?.angle).toBe(0)
  })

  it('leaves a cell with no rotation alone', () => {
    grid()
    expect(recorded.texts.find((one) => one.text === 'Q1')?.angle).toBe(0)
  })
})

describe('a sheet drawn larger', () => {
  it('makes the cells bigger by the same factor', () => {
    grid({ zoom: 2, styleAt: () => ({ background: '#DDEEFF' }) })

    // A column is 84 unzoomed, and the header 44.
    const fill = recorded.fills.find((one) => one.style === '#DDEEFF')
    expect(fill?.width).toBe(168)
    expect(fill?.x).toBe(88)
  })

  it('makes the words bigger with them', () => {
    grid({ zoom: 2, styleAt: () => ({ font: '11px Calibri' }) })

    expect(recorded.texts.find((one) => one.text === 'Q1')?.font).toContain('22px')
  })

  it('scrolls as far as the zoomed sheet is long', () => {
    const { container } = grid({ zoom: 2 })
    const content = container.querySelector<HTMLElement>('[role="grid"] > div')

    // Three rows of 22 and a header of 22, all doubled.
    expect(content?.style.height).toBe('176px')
  })
})

describe('a mark in the corner of a cell', () => {
  it('draws a small triangle in the colour the caller asks for', () => {
    grid({ styleAt: ({ row, column }) => (row === 0 && column === 0 ? { corner: '#B00' } : null) })

    const mark = recorded.paths.find((one) => one.style === '#B00')
    expect(mark?.points).toHaveLength(3)
  })

  it('draws it over the value, not under it', () => {
    // A wide number painted across the corner would hide the one thing that
    // says there is more here than the number.
    grid({
      valueAt: () => '1234567890',
      styleAt: ({ row, column }) => (row === 0 && column === 0 ? { corner: '#B00' } : null),
    })

    const mark = recorded.paths.findIndex((one) => one.style === '#B00')
    expect(mark).toBeGreaterThanOrEqual(0)
  })
})

describe('the cell under the pointer', () => {
  it('is reported as it moves, and forgotten when it leaves', () => {
    const hovered = vi.fn()
    const { container } = grid({ onHoverCell: hovered })

    const surface = container.querySelector('[role="grid"] > div')
    if (surface === null) throw new Error('the grid has no surface')

    fireEvent.pointerMove(surface, { clientX: 60, clientY: 30 })
    expect(hovered).toHaveBeenCalledWith({ row: 0, column: 0 })

    fireEvent.pointerLeave(surface)
    expect(hovered).toHaveBeenLastCalledWith(null)
  })
})

describe('a value whose pieces do not all look alike', () => {
  const pieces = [
    { text: 'Total: ', font: '11px Calibri' },
    { text: '1 234', font: 'bold 11px Calibri', color: '#C00000' },
  ]

  it('draws each piece in its own font and colour', () => {
    grid({ valueAt: () => 'Total: 1 234', styleAt: () => ({ runs: pieces }) })

    expect(recorded.texts.find((one) => one.text === 'Total: ')?.font).toBe('11px Calibri')
    expect(recorded.texts.find((one) => one.text === '1 234')?.font).toBe('bold 11px Calibri')
  })

  it('joins them up, so the second starts where the first ended', () => {
    grid({ valueAt: () => 'Total: 1 234', styleAt: () => ({ runs: pieces }) })

    const first = recorded.texts.find((one) => one.text === 'Total: ')
    const second = recorded.texts.find((one) => one.text === '1 234')

    // The fake canvas measures seven points a character, so seven characters
    // put the second piece forty-nine along from the first.
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBeCloseTo(49)
  })

  it('still hands the whole value to a screen reader', () => {
    // What is drawn is pieces; what the cell holds is a string.
    grid({ valueAt: () => 'Total: 1 234', styleAt: () => ({ runs: pieces }) })

    expect(screen.getByRole('grid').textContent).toContain('Total: 1 234')
  })

  it('wraps across the pieces, breaking wherever the space falls', () => {
    grid({
      valueAt: () => 'one two three four five',
      styleAt: () => ({
        wrap: true,
        runs: [
          { text: 'one two ', font: '11px Calibri' },
          { text: 'three four five', font: 'bold 11px Calibri' },
        ],
      }),
    })

    const drawnLines = new Set(
      recorded.texts.filter((one) => one.text.length > 2).map((one) => one.y),
    )
    expect(drawnLines.size).toBeGreaterThan(1)
  })
})

describe('selecting with the pointer', () => {
  /** The surface the pointer events land on, under the scrolling container. */
  const surfaceOf = (container: HTMLElement) => {
    const surface = container.querySelector('[role="grid"] > div')
    if (surface === null) throw new Error('the grid has no surface')
    return surface
  }

  const at = (column: number, row: number) => ({
    // Headers are 44 across and 22 down; a cell is 84 by 22.
    clientX: 44 + column * 84 + 10,
    clientY: 22 + row * 22 + 10,
  })

  it('reports a click as one cell', () => {
    const chosen = vi.fn()
    const { container } = grid({ onSelectionChange: chosen })

    fireEvent.pointerDown(surfaceOf(container), at(1, 1))

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: { row: 1, column: 1 } }),
    )
  })

  it('drags a range out, keeping the corner it started from', () => {
    const chosen = vi.fn()
    const { container } = grid({ onSelectionChange: chosen })
    const surface = surfaceOf(container)

    fireEvent.pointerDown(surface, at(0, 0))
    fireEvent.pointerMove(surface, at(2, 2))
    fireEvent.pointerUp(surface, at(2, 2))

    const last = chosen.mock.calls.at(-1)?.[0] as { ranges: { anchor: unknown; focus: unknown }[] }
    expect(last.ranges[0]).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: 2, column: 2 },
    })
  })

  it('leaves the cursor at the corner a drag started from', () => {
    // It is where a typed value would land; dragging picks a range, it does
    // not move the cell being typed into.
    const chosen = vi.fn()
    const { container } = grid({ onSelectionChange: chosen })
    const surface = surfaceOf(container)

    fireEvent.pointerDown(surface, at(0, 0))
    fireEvent.pointerMove(surface, at(2, 2))

    expect((chosen.mock.calls.at(-1)?.[0] as { active: unknown }).active).toEqual({
      row: 0,
      column: 0,
    })
  })

  it('adds a second range when Mod is held', () => {
    const chosen = vi.fn()
    const { container } = grid({ onSelectionChange: chosen })
    const surface = surfaceOf(container)

    fireEvent.pointerDown(surface, at(0, 0))
    fireEvent.pointerDown(surface, { ...at(2, 2), metaKey: true })

    expect((chosen.mock.calls.at(-1)?.[0] as { ranges: unknown[] }).ranges).toHaveLength(2)
  })

  it('takes a whole column from its letter, and a whole row from its number', () => {
    const chosen = vi.fn()
    const { container } = grid({ rows: 3, columns: 3, onSelectionChange: chosen })
    const surface = surfaceOf(container)

    fireEvent.pointerDown(surface, { clientX: 44 + 84 + 10, clientY: 10 })
    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [{ anchor: { row: 0, column: 1 }, focus: { row: 2, column: 1 } }],
      }),
    )

    fireEvent.pointerDown(surface, { clientX: 10, clientY: 22 + 22 + 10 })
    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [{ anchor: { row: 1, column: 0 }, focus: { row: 1, column: 2 } }],
      }),
    )
  })

  it('takes everything from the corner box', () => {
    const chosen = vi.fn()
    const { container } = grid({ rows: 3, columns: 3, onSelectionChange: chosen })

    fireEvent.pointerDown(surfaceOf(container), { clientX: 10, clientY: 10 })

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 2 } }],
      }),
    )
  })
})

describe('selecting with the keyboard', () => {
  const press = (key: string, modifiers: Record<string, boolean> = {}) => {
    fireEvent.keyDown(screen.getByRole('grid'), { key, ...modifiers })
  }

  it('extends with Shift and an arrow, without moving the cursor', () => {
    const chosen = vi.fn()
    grid({ onSelectionChange: chosen })

    press('ArrowDown', { shiftKey: true })
    press('ArrowRight', { shiftKey: true })

    const last = chosen.mock.calls.at(-1)?.[0] as {
      active: unknown
      ranges: { focus: unknown }[]
    }
    expect(last.active).toEqual({ row: 0, column: 0 })
    expect(last.ranges[0]?.focus).toEqual({ row: 1, column: 1 })
  })

  it('collapses the range when an arrow is pressed on its own', () => {
    const chosen = vi.fn()
    grid({ onSelectionChange: chosen })

    press('ArrowDown', { shiftKey: true })
    press('ArrowDown')

    expect((chosen.mock.calls.at(-1)?.[0] as { ranges: unknown[] }).ranges).toHaveLength(1)
    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: { row: 1, column: 0 } }),
    )
  })

  it('jumps to the end of the values with Mod and an arrow', () => {
    const chosen = vi.fn()
    // Three rows of values and nothing after them.
    grid({ rows: 20, onSelectionChange: chosen })

    press('ArrowDown', { metaKey: true })

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: { row: 2, column: 0 } }),
    )
  })

  it('takes everything with Mod and A', () => {
    const chosen = vi.fn()
    grid({ rows: 3, columns: 3, onSelectionChange: chosen })

    press('a', { metaKey: true })

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 2 } }],
      }),
    )
  })

  it('says how much is selected, for somebody who cannot see it', () => {
    grid()

    press('ArrowDown', { shiftKey: true })
    press('ArrowRight', { shiftKey: true })

    expect(screen.getByRole('grid').textContent).toContain('4 cells selected')
  })
})

describe('a selection the caller owns', () => {
  it('shows what it is given rather than what it chose', () => {
    grid({
      selection: {
        ranges: [{ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } }],
        active: { row: 1, column: 1 },
      },
    })

    // Nine cells of wash under the four selected, drawn in the selection's
    // own translucent orange.
    expect(recorded.fills.some((one) => one.style === 'rgba(255, 122, 0, 0.12)')).toBe(true)
  })
})

describe('typing into a block of cells', () => {
  const block = {
    ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }],
    active: { row: 0, column: 0 },
  }

  it('moves the cursor inside the selection and leaves the selection alone', () => {
    const chosen = vi.fn()
    grid({ selection: block, onSelectionChange: chosen })

    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })

    const last = chosen.mock.calls.at(-1)?.[0] as { active: unknown; ranges: unknown[] }
    expect(last.active).toEqual({ row: 1, column: 0 })
    expect(last.ranges).toEqual(block.ranges)
  })

  it('turns the corner rather than walking out of the block', () => {
    const chosen = vi.fn()
    grid({ selection: { ...block, active: { row: 1, column: 0 } }, onSelectionChange: chosen })

    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: { row: 0, column: 1 } }),
    )
  })

  it('moves the cursor and the selection when only one cell is selected', () => {
    const chosen = vi.fn()
    grid({ onSelectionChange: chosen })

    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: { row: 1, column: 0 } }),
    )
  })

  it('goes back up on Shift and Enter', () => {
    const chosen = vi.fn()
    grid({ selection: { ...block, active: { row: 1, column: 1 } }, onSelectionChange: chosen })

    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter', shiftKey: true })

    expect(chosen).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: { row: 0, column: 1 } }),
    )
  })
})

describe('what Enter does while a cell is being edited', () => {
  const open = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('grid'))
    await user.keyboard('{F2}')
    return { user, field: screen.getByRole('textbox') }
  }

  it('puts a line break in the cell on Alt and Enter, rather than finishing', async () => {
    const changed = vi.fn()
    grid({ onChange: changed })

    const { field } = await open()
    fireEvent.keyDown(field, { key: 'Enter', altKey: true })

    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Q1\n')
    expect(changed).not.toHaveBeenCalled()
  })

  it('fills everything selected on Mod and Enter', async () => {
    const filled = vi.fn()
    const changed = vi.fn()
    grid({
      onChange: changed,
      onFill: filled,
      selection: {
        ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }],
        active: { row: 0, column: 0 },
      },
    })

    const { field } = await open()
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })

    // One call with the whole selection, not one per cell: filling a block is
    // one thing somebody did.
    expect(filled).toHaveBeenCalledTimes(1)
    expect(filled.mock.calls[0]?.[1]).toBe('Q1')
    expect(changed).not.toHaveBeenCalled()
  })

  it('finishes the edit on a plain Enter, as it always did', async () => {
    const changed = vi.fn()
    grid({ onChange: changed })

    const { field } = await open()
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(changed).toHaveBeenCalledWith({ row: 0, column: 0 }, 'Q1')
  })
})

describe('an edge somebody double-clicks', () => {
  const surfaceOf = (container: HTMLElement) => {
    const surface = container.querySelector('[role="grid"] > div')
    if (surface === null) throw new Error('the grid has no surface')
    return surface
  }

  /** The boundary at the right of a column, where the header is. */
  const edgeOf = (column: number) => ({ clientX: 44 + (column + 1) * 84, clientY: 10 })

  it('fits the column to the values in it', () => {
    const sized = vi.fn()
    const { container } = grid({ onResize: sized, valueAt: () => 'a much longer value' })

    fireEvent.doubleClick(surfaceOf(container), edgeOf(0))

    expect(sized).toHaveBeenCalledTimes(1)
    expect(sized.mock.calls[0]?.[0]).toBe('column')
    expect(sized.mock.calls[0]?.[1]).toBe(0)
    // Nineteen letters at seven points each, and room beside them.
    expect(sized.mock.calls[0]?.[2]).toBeGreaterThan(19 * 7)
  })

  it('fits a narrow column to a narrow value', () => {
    const sized = vi.fn()
    const { container } = grid({ onResize: sized, valueAt: () => 'x' })

    fireEvent.doubleClick(surfaceOf(container), edgeOf(0))
    expect(sized.mock.calls[0]?.[2]).toBeLessThan(30)
  })

  it('leaves an empty column the width it was', () => {
    // A column of blanks has no opinion about its width, and collapsing it
    // would hide it.
    const sized = vi.fn()
    const { container } = grid({ onResize: sized, valueAt: () => null })

    fireEvent.doubleClick(surfaceOf(container), edgeOf(0))
    expect(sized).not.toHaveBeenCalled()
  })

  it('never makes a column wider than the window', () => {
    const sized = vi.fn()
    const { container } = grid({ onResize: sized, valueAt: () => 'x'.repeat(500) })

    fireEvent.doubleClick(surfaceOf(container), edgeOf(0))
    expect(sized.mock.calls[0]?.[2]).toBeLessThanOrEqual(340)
  })

  it('fits a row to a value that wraps', () => {
    // The wrap is the whole reason a row has a height worth fitting: a cell
    // told to fold its words needs as many lines as the words come to.
    const sized = vi.fn()
    const { container } = grid({
      onResize: sized,
      valueAt: () => 'one two three four five six seven eight nine ten',
      styleAt: () => ({ wrap: true }),
    })

    fireEvent.doubleClick(surfaceOf(container), { clientX: 10, clientY: 22 + 22 })

    expect(sized.mock.calls[0]?.[0]).toBe('row')
    expect(sized.mock.calls[0]?.[2]).toBeGreaterThan(22)
  })

  it('opens the editor where there is no edge under it, as it always did', async () => {
    const sized = vi.fn()
    const { container } = grid({ onResize: sized, onChange: vi.fn() })

    fireEvent.doubleClick(surfaceOf(container), { clientX: 44 + 10, clientY: 22 + 10 })

    expect(sized).not.toHaveBeenCalled()
    expect(await screen.findByRole('textbox')).toBeDefined()
  })
})
