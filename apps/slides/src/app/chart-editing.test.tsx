import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import { allSeries, readChart } from '@orangery/charts'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Changing a chart by changing its numbers.
 *
 * The grid is a view of the chart part, so every assertion reads the part
 * back: a cell that shows a new number and a chart that draws the old one is
 * the failure worth catching.
 *
 * The cells are drawn on a canvas, so there is nothing to click; they are
 * reached the way a person reaches them, by moving the selection and typing.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')
const CHART_PART = 'ppt/charts/chart1.xml'

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  const bytes = await readFile(join(FIXTURES, 'charts.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/charts.pptx')
  })
})

/** Selects the first chart on the slide. */
const pickChart = () => {
  act(() => {
    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    const chart = shapes.find((shape) => shape.graphic?.kind === 'chart')
    useDeckStore.getState().selectShapes([chart?.id ?? -1])
  })
}

/** Opens the chart data editor, which is where the numbers are. */
const openData = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Edit data' }))
}

/** Empties the cell at this address, as Delete does in any spreadsheet. */
async function clearCell(
  user: ReturnType<typeof userEvent.setup>,
  cell: { row: number; column: number },
) {
  await user.click(screen.getByRole('grid', { name: 'Chart data' }))
  await user.keyboard('{ArrowUp>10/}{ArrowLeft>10/}')
  if (cell.row > 0) await user.keyboard(`{ArrowDown>${String(cell.row)}/}`)
  if (cell.column > 0) await user.keyboard(`{ArrowRight>${String(cell.column)}/}`)
  await user.keyboard('{Delete}')
}

/** Types into the cell at this address, counting from the top left. */
async function typeInCell(
  user: ReturnType<typeof userEvent.setup>,
  cell: { row: number; column: number },
  text: string,
) {
  await user.click(screen.getByRole('grid', { name: 'Chart data' }))
  await user.keyboard('{ArrowUp>10/}{ArrowLeft>10/}')
  if (cell.row > 0) await user.keyboard(`{ArrowDown>${String(cell.row)}/}`)
  if (cell.column > 0) await user.keyboard(`{ArrowRight>${String(cell.column)}/}`)
  await user.keyboard(`${text}{Enter}`)
}

const valuesOf = () => {
  const { open } = useDeckStore.getState()
  const chart = readChart(
    getPartText(open?.package ?? { parts: new Map() }, 'ppt/charts/chart1.xml') ?? '',
  )
  return chart === null ? [] : allSeries(chart).map((series) => series.values)
}

describe('the grid behind a chart', () => {
  it('opens on the chart that is selected, with a column per series', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    const grid = screen.getByRole('grid', { name: 'Chart data' })
    // Four points and the header row above them, as the workbook has it.
    expect(grid).toHaveAttribute('aria-rowcount', '5')
    // The categories and the two series.
    expect(grid).toHaveAttribute('aria-colcount', '3')
  })

  it('says which cell it is on, for a reader who cannot see the paint', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    await user.click(screen.getByRole('grid', { name: 'Chart data' }))
    await user.keyboard('{ArrowRight}{ArrowDown}')

    // B2 in the sheet the chart is drawn from: the first number of the first
    // series, under its name.
    expect(screen.getByRole('grid', { name: 'Chart data' }).textContent).toContain('B, row 2: 10.5')
  })

  it('is not offered for a shape that is not a chart', async () => {
    // The charts fixture is charts all the way down, so this needs another deck.
    const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
    })

    render(<App />)
    act(() => {
      const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
      useDeckStore.getState().selectShapes([shapes[0]?.id ?? -1])
    })

    expect(screen.queryByRole('button', { name: 'Edit data' })).not.toBeInTheDocument()
  })
})

describe('changing a number', () => {
  it('reaches the chart the deck draws from', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 2, column: 1 }, '99')

    await waitFor(() => {
      expect(valuesOf()[0]).toEqual([10.5, 99, 9.8, 18.1])
    })
  })

  it('leaves the other series where it was', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 2, column: 1 }, '99')

    await waitFor(() => {
      expect(valuesOf()[1]).toEqual([7.1, 8.4, 8.9, 10])
    })
  })

  it('changes the workbook Edit Data would open, not only the cache', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 2, column: 1 }, '99')

    // PowerPoint rebuilds the cache from the workbook the moment anybody opens
    // the data, so a chart edited in only one of them loses the edit.
    await waitFor(() => {
      const bytes = useDeckStore
        .getState()
        .open?.package.parts.get('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes
      expect(bytes).not.toBeUndefined()
    })
  })

  it('is one step to undo', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 2, column: 1 }, '99')
    await waitFor(() => {
      expect(valuesOf()[0]?.[1]).toBe(99)
    })

    act(() => {
      useDeckStore.getState().undo()
    })

    // Both halves went in together, so both come back together.
    expect(valuesOf()[0]).toEqual([10.5, 14.2, 9.8, 18.1])
  })
})

describe('changing a name', () => {
  const namesOf = () => {
    const { open } = useDeckStore.getState()
    const chart = readChart(
      getPartText(open?.package ?? { parts: new Map() }, 'ppt/charts/chart1.xml') ?? '',
    )
    return chart?.categories ?? []
  }

  it('reaches the chart the deck draws from', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 2, column: 0 }, 'Spring')

    await waitFor(() => {
      expect(namesOf()).toEqual(['Q1', 'Spring', 'Q3', 'Q4'])
    })
  })

  it('shows the new name in the grid it was typed into', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 1, column: 0 }, 'Spring')

    // The grid reads the chart part back, so the name it shows is the name
    // that was saved rather than the one that was typed.
    await waitFor(() => {
      expect(namesOf()[0]).toBe('Spring')
    })
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('grid', { name: 'Chart data' }).textContent).toContain(
      'A, row 2: Spring',
    )
  })

  it('is one step to undo, cache and workbook together', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await openData(user)
    await typeInCell(user, { row: 2, column: 0 }, 'Spring')
    await waitFor(() => {
      expect(namesOf()[1]).toBe('Spring')
    })

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(namesOf()).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
  })
})

describe('how many points there are', () => {
  /** The points, which is the rows of the grid without its header row. */
  const points = () =>
    Number(screen.getByRole('grid', { name: 'Chart data' }).getAttribute('aria-rowcount')) - 1

  it('adds one to every series at once', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)
    const before = points()

    await user.click(screen.getByRole('button', { name: 'Add point' }))

    await waitFor(() => {
      expect(points()).toBe(before + 1)
    })
    expect(valuesOf()[0]).toHaveLength(before + 1)
    expect(valuesOf()[1]).toHaveLength(before + 1)
  })

  it('takes one away from every series at once', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)
    const before = points()

    await user.click(screen.getByRole('button', { name: 'Remove point' }))

    await waitFor(() => {
      expect(valuesOf()[0]).toHaveLength(before - 1)
    })
    expect(valuesOf()[1]).toHaveLength(before - 1)
  })

  it('moves the workbook’s rows with it', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    await user.click(screen.getByRole('button', { name: 'Add point' }))

    // The cache and the workbook have to agree about how many rows there are,
    // or PowerPoint rebuilds one from the other and the point disappears.
    await waitFor(() => {
      expect(valuesOf()[0]).toHaveLength(5)
    })
    const bytes = useDeckStore
      .getState()
      .open?.package.parts.get('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes
    expect(bytes).not.toBeUndefined()
  })

  it('is one step to undo', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)
    const before = valuesOf()[0]?.length ?? 0

    await user.click(screen.getByRole('button', { name: 'Add point' }))
    await waitFor(() => {
      expect(valuesOf()[0]).toHaveLength(before + 1)
    })

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(valuesOf()[0]).toHaveLength(before)
  })
})

describe('changing what the chart is', () => {
  const partOf = () => {
    const { open } = useDeckStore.getState()
    return getPartText(open?.package ?? { parts: new Map() }, 'ppt/charts/chart1.xml') ?? ''
  }

  it('changes the kind of chart the deck draws', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Chart type' }), 'line')

    await waitFor(() => {
      expect(readChart(partOf())?.plots[0]?.kind).toBe('line')
    })
    // The numbers come across; changing the picture is not changing the data.
    expect(valuesOf()[0]).toEqual([10.5, 14.2, 9.8, 18.1])
  })

  it('moves the legend', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Legend' }), 't')

    await waitFor(() => {
      expect(readChart(partOf())?.legend).toBe('t')
    })
  })

  it('turns the labels on', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await user.click(screen.getByRole('checkbox', { name: 'Values' }))

    await waitFor(() => {
      expect(readChart(partOf())?.plots[0]?.labels.values).toBe(true)
    })
  })

  it('fixes the scale of the value axis', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    const max = screen.getByRole('spinbutton', { name: 'Maximum' })
    await user.clear(max)
    await user.type(max, '40')
    await user.tab()

    await waitFor(() => {
      expect(readChart(partOf())?.axes.find((axis) => axis.kind === 'value')?.max).toBe(40)
    })
  })

  it('is one step to undo, like any other edit', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Legend' }), 't')
    await waitFor(() => {
      expect(readChart(partOf())?.legend).toBe('t')
    })

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(readChart(partOf())?.legend).toBe('b')
  })

  it('leaves the parts of the chart nobody asked about', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    const before = partOf()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Legend' }), 't')

    await waitFor(() => {
      expect(partOf()).not.toBe(before)
    })
    // The series and their cached numbers are untouched by a change of legend.
    expect(partOf()).toContain('Revenue')
    expect(partOf()).toContain('10.5')
  })
})

describe('a cell emptied rather than zeroed', () => {
  it('leaves a gap in the chart, not a bar of no height', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    // Delete on the cell, which is how a spreadsheet empties one. `Number('')`
    // is nought, and a chart with a nought where a gap belongs draws a bar
    // nobody asked for.
    await clearCell(user, { row: 2, column: 1 })

    await waitFor(() => {
      expect(valuesOf()[0]).toEqual([10.5, null, 9.8, 18.1])
    })
  })

  it('empties the cell in the workbook too, so the two halves agree', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    await clearCell(user, { row: 2, column: 1 })
    await waitFor(() => {
      expect(valuesOf()[0]?.[1]).toBeNull()
    })

    const bytes = useDeckStore
      .getState()
      .open?.package.parts.get('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes
    const workbook = await readPackage(bytes ?? new Uint8Array())
    const sheet = getPartText(workbook, 'xl/worksheets/sheet1.xml') ?? ''

    // The cell is gone, not set to nought — otherwise PowerPoint rebuilds the
    // cache from it and the gap becomes a bar again.
    expect(sheet).not.toContain('r="B3"')
    expect(sheet).toContain('r="C3"')
  })
})

describe('renaming a series', () => {
  it('reaches the chart the deck draws from', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    // The header row of the table, which is where a series is named — in the
    // legend and in the cell the name came from.
    await typeInCell(user, { row: 0, column: 1 }, 'Income')

    await waitFor(() => {
      const chart = readChart(
        getPartText(useDeckStore.getState().open?.package ?? { parts: new Map() }, CHART_PART) ??
          '',
      )
      expect(chart === null ? [] : allSeries(chart).map((one) => one.name)).toEqual([
        'Income',
        'Costs',
      ])
    })
  })

  it('renames the cell in the workbook too, so Edit Data agrees', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    await typeInCell(user, { row: 0, column: 1 }, 'Income')

    await waitFor(async () => {
      const bytes = useDeckStore
        .getState()
        .open?.package.parts.get('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes
      const workbook = await readPackage(bytes ?? new Uint8Array())
      expect(getPartText(workbook, 'xl/worksheets/sheet1.xml')).toContain('Income')
    })
  })

  it('is one step to undo, cache and workbook together', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    await openData(user)

    await typeInCell(user, { row: 0, column: 1 }, 'Income')
    await waitFor(() => {
      const chart = readChart(
        getPartText(useDeckStore.getState().open?.package ?? { parts: new Map() }, CHART_PART) ??
          '',
      )
      expect(chart === null ? [] : allSeries(chart)[0]?.name).toBe('Income')
    })

    act(() => {
      useDeckStore.getState().undo()
    })

    const chart = readChart(
      getPartText(useDeckStore.getState().open?.package ?? { parts: new Map() }, CHART_PART) ?? '',
    )
    expect(chart === null ? [] : allSeries(chart)[0]?.name).toBe('Revenue')
  })
})
