import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recorded } from '../test-setup'
import { openWorkbook } from '../document/workbook'
import type { OpenWorkbook } from '../document/workbook'
import { SheetView } from './sheet-view'

/**
 * A worksheet, drawn.
 *
 * The cells are paint, so what is asserted here is what the grid was handed:
 * the strings a sheet shows and the shape it is drawn in. Whether the paint
 * lands where it should is the grid's own suite.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let workbook: OpenWorkbook

beforeAll(async () => {
  workbook = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
})

beforeEach(() => {
  recorded.reset()
})

const drawn = () => {
  const sheet = workbook.sheets[0]
  if (sheet === undefined) throw new Error('the fixture has no sheets')

  render(<SheetView open={workbook} sheet={sheet} width={800} height={400} />)
  return screen.getByRole('grid', { name: 'Budget' })
}

/** What the grid says about the cell it is on, which is the formatted value. */
const announced = async (
  user: ReturnType<typeof userEvent.setup>,
  grid: HTMLElement,
  cell: { row: number; column: number },
) => {
  await user.click(grid)
  await user.keyboard('{ArrowUp>10/}{ArrowLeft>10/}')
  if (cell.row > 0) await user.keyboard(`{ArrowDown>${String(cell.row)}/}`)
  if (cell.column > 0) await user.keyboard(`{ArrowRight>${String(cell.column)}/}`)

  return grid.textContent
}

describe('what the sheet shows', () => {
  it('is a grid named after the sheet', () => {
    drawn()
    expect(screen.getByRole('grid', { name: 'Budget' })).toBeInTheDocument()
  })

  it('holds the rows and columns the cells reach, with room past them', () => {
    // A sheet somebody scrolls is a sheet with somewhere to scroll to: Excel
    // shows empty rows below the last one rather than stopping dead.
    drawn()
    const grid = screen.getByRole('grid', { name: 'Budget' })

    expect(Number(grid.getAttribute('aria-rowcount'))).toBeGreaterThan(3)
    expect(Number(grid.getAttribute('aria-colcount'))).toBeGreaterThanOrEqual(26)
  })

  it('reads a shared string through the table rather than as its index', () => {
    // The classic way to show 0 where January was meant.
    expect(drawn().textContent).toContain('A, row 1: Month')
  })
})

describe('what a cell is shown as', () => {
  it('formats a number by the code its style points at', async () => {
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 1, column: 1 })).toContain('B, row 2: 1,234.50')
  })

  it('shows a date as a date rather than as the number it is', async () => {
    // 45292 with format 14 is the 1st of January 2024; without the format it
    // is a five-figure number nobody typed.
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 1, column: 2 })).toContain('C, row 2: 01-01-24')
  })

  it('shows a percentage as one', async () => {
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 2, column: 2 })).toContain('C, row 3: 16%')
  })

  it('shows a negative through the same format as a positive', async () => {
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 2, column: 1 })).toContain('B, row 3: -99.00')
  })
})

describe('what a rule does to a cell', () => {
  /**
   * The fixture puts a rule on the two figures in column B: anything below
   * nought takes the format Excel offers first — light red fill, dark red
   * bold text — and the percentage in C3 gets a bar across it.
   */

  it('lays the rule’s colours over the cell that matched', () => {
    drawn()

    expect(recorded.fills.some((one) => one.style === '#FFC7CE')).toBe(true)
    expect(recorded.texts.find((one) => one.text === '-99.00')?.font).toContain('bold')
  })

  it('leaves the cell that did not match alone', () => {
    drawn()

    // 1,234.50 is in the same range and above nought; a rule applied to the
    // range rather than to the values would have reddened it too.
    expect(recorded.texts.find((one) => one.text === '1,234.50')?.font).not.toContain('bold')
  })

  it('draws the bar the rule asks for, with the number still on it', () => {
    drawn()

    expect(recorded.fills.some((one) => one.style === '#638EC6')).toBe(true)
    expect(recorded.texts.some((one) => one.text === '16%')).toBe(true)
  })
})

describe('the ways a sheet writes in a cell', () => {
  /**
   * The second sheet of the fixture is where the awkward cells live: it is
   * left at 150 %, one cell wraps across a tall row, and one is turned on its
   * side. Keeping them off the first sheet means the plain cases stay plain.
   */
  const notes = () => {
    const sheet = workbook.sheets[1]
    if (sheet === undefined) throw new Error('the fixture has no second sheet')

    render(<SheetView open={workbook} sheet={sheet} width={800} height={400} />)
    return screen.getByRole('grid', { name: 'Notes' })
  }

  it('opens the sheet at the zoom it was left at', () => {
    notes()

    // 12 points at 150 % is 18; a sheet opened at 100 % is a different sheet
    // from the one somebody put away.
    expect(recorded.texts.find((one) => one.text === 'A')?.font).toContain('18px')
  })

  it('breaks a wrapped value across the lines the row has room for', () => {
    notes()

    const words = recorded.texts.filter((one) => one.text.startsWith('Everything'))
    expect(words).toHaveLength(1)
    expect(words[0]?.text).not.toBe('Everything in this column is written across several lines')
  })

  it('turns a cell the file says is turned', () => {
    notes()

    // 90 in the file is a quarter turn anticlockwise, which on a canvas — where
    // y points down — is a quarter turn the other way.
    expect(recorded.texts.find((one) => one.text === 'Sideways')?.angle).toBeCloseTo(-Math.PI / 2)
  })
})

describe('what sits on the sheet rather than in it', () => {
  it('puts the chart the drawing part points at over the cells', () => {
    drawn()

    const chart = screen.getByLabelText('Spending by month')
    expect(chart).toHaveAttribute('data-drawing', 'chart')
    expect(chart.querySelector('svg')).not.toBeNull()
  })

  it('shows the picture, from the bytes in the package', () => {
    drawn()

    const picture = screen.getByLabelText('Logo').querySelector('img')
    expect(picture?.getAttribute('src')).toMatch(/^data:image\/png;base64,/u)
  })

  it('sizes a two-cell anchor from the cells it spans', () => {
    drawn()

    // B5 to D13: two columns of the default width, which the sheet gives as
    // 8.43 characters of seven points, and eight rows of twenty.
    const chart = screen.getByLabelText('Spending by month')
    expect(chart.style.width).toBe('118px')
    expect(chart.style.height).toBe('160px')
  })

  it('sizes a one-cell anchor from the size it states, not from the cells', () => {
    drawn()

    // 914400 EMU is an inch, which is seventy-two points.
    const picture = screen.getByLabelText('Logo')
    expect(picture.style.width).toBe('72px')
  })
})
