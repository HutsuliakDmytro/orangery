import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { findDescendant } from '@orangery/ooxml-core'
import { columnCount, flatten, rowCount } from '@orangery/ooxml-presentation'
import { readTable } from '@orangery/ooxml-drawingml'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Editing a table through the window.
 *
 * The grid staying rectangular is what every one of these is really about: a
 * row with a cell missing is a file PowerPoint refuses, and nothing on screen
 * would say so.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

/** The `a:tbl` of the slide's first table, as it stands. */
function tableNode() {
  const slide = useDeckStore.getState().open?.deck.slides[0]
  const frame = flatten(slide?.shapes ?? []).find((shape) => shape.kind === 'graphicFrame')
  const node = frame === undefined ? undefined : findDescendant(frame.node, 'a:tbl')
  if (frame === undefined || node === undefined) throw new Error('fixture has no table')
  return { id: frame.id, node }
}

const isRectangular = () => {
  const { node } = tableNode()
  const columns = columnCount(node)
  return readTable(node).rows.every((row) => row.cells.length === columns)
}

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  const bytes = await readFile(join(FIXTURES, 'table.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/table.pptx')
  })
})

function clickCell(row: number, column: number, shift = false) {
  const canvas = within(screen.getByTestId('canvas'))
  const cell = canvas.getByRole('button', {
    name: `Cell ${String(row + 1)}, ${String(column + 1)}`,
  })
  fireEvent.pointerDown(cell, { shiftKey: shift })
}

describe('picking cells', () => {
  it('picks the one that was clicked', () => {
    render(<App />)
    clickCell(1, 1)

    expect(useDeckStore.getState().cells).toMatchObject({
      row: 1,
      column: 1,
      toRow: 1,
      toColumn: 1,
    })
  })

  it('grows the block on a shift click', () => {
    render(<App />)
    clickCell(0, 0)
    clickCell(1, 1, true)

    expect(useDeckStore.getState().cells).toMatchObject({
      row: 0,
      column: 0,
      toRow: 1,
      toColumn: 1,
    })
  })

  it('selects the table itself, so the frame can be moved', () => {
    render(<App />)
    const { id } = tableNode()
    clickCell(0, 0)

    expect(useDeckStore.getState().selection).toEqual([id])
  })
})

describe('rows and columns', () => {
  it('adds a row below the one picked', () => {
    render(<App />)
    const before = rowCount(tableNode().node)
    clickCell(0, 0)

    act(() => {
      runCommand('table.row-below', {})
    })

    expect(rowCount(tableNode().node)).toBe(before + 1)
    expect(isRectangular()).toBe(true)
  })

  it('adds a column and gives every row a cell for it', () => {
    render(<App />)
    const before = columnCount(tableNode().node)
    clickCell(0, 0)

    act(() => {
      runCommand('table.column-right', {})
    })

    expect(columnCount(tableNode().node)).toBe(before + 1)
    expect(isRectangular()).toBe(true)
  })

  it('takes a row away', () => {
    render(<App />)
    const before = rowCount(tableNode().node)
    clickCell(0, 0)

    act(() => {
      runCommand('table.delete-row', {})
    })

    expect(rowCount(tableNode().node)).toBe(before - 1)
    expect(isRectangular()).toBe(true)
  })

  it('is offered only once a cell has been picked', () => {
    render(<App />)
    expect(getCommand('table.row-below')?.isEnabled?.({})).toBe(false)
    clickCell(0, 0)
    expect(getCommand('table.row-below')?.isEnabled?.({})).toBe(true)
  })
})

describe('merging', () => {
  it('is greyed out for a single cell, because that is not a merge', () => {
    render(<App />)
    clickCell(0, 0)
    expect(getCommand('table.merge')?.isEnabled?.({})).toBe(false)

    clickCell(0, 1, true)
    expect(getCommand('table.merge')?.isEnabled?.({})).toBe(true)
  })

  it('joins the block and keeps the grid rectangular', () => {
    render(<App />)
    clickCell(0, 0)
    clickCell(0, 1, true)

    act(() => {
      runCommand('table.merge', {})
    })

    const table = readTable(tableNode().node)
    expect(table.rows[0]?.cells[0]?.gridSpan).toBe(2)
    expect(table.rows[0]?.cells[1]?.horizontallyMerged).toBe(true)
    expect(isRectangular()).toBe(true)
  })

  it('splits it again', () => {
    render(<App />)
    clickCell(0, 0)
    clickCell(0, 1, true)
    act(() => {
      runCommand('table.merge', {})
    })

    clickCell(0, 0)
    act(() => {
      runCommand('table.split', {})
    })

    const table = readTable(tableNode().node)
    expect(table.rows[0]?.cells[0]?.gridSpan).toBe(1)
    expect(table.rows[0]?.cells[1]?.horizontallyMerged).toBe(false)
  })

  it('is one step to take back', () => {
    render(<App />)
    clickCell(0, 0)
    clickCell(0, 1, true)
    act(() => {
      runCommand('table.merge', {})
    })

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(readTable(tableNode().node).rows[0]?.cells[0]?.gridSpan).toBe(1)
  })
})
