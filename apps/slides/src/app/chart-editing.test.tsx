import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { allSeries, readChart } from '@orangery/ooxml-drawingml'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Changing a chart by changing its numbers.
 *
 * The table is a view of the chart part, so every assertion reads the part
 * back: a box that shows a new number and a chart that draws the old one is
 * the failure worth catching.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

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

const valuesOf = () => {
  const { open } = useDeckStore.getState()
  const chart = readChart(
    getPartText(open?.package ?? { parts: new Map() }, 'ppt/charts/chart1.xml') ?? '',
  )
  return chart === null ? [] : allSeries(chart).map((series) => series.values)
}

describe('the table behind a chart', () => {
  it('shows a box for every point of every series', () => {
    render(<App />)
    pickChart()

    expect(screen.getByRole('spinbutton', { name: 'Revenue, Q1' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Costs, Q4' })).toBeInTheDocument()
  })

  it('is not there for a shape that is not a chart', async () => {
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

    expect(screen.queryByLabelText('Chart data')).not.toBeInTheDocument()
  })
})

describe('changing a number', () => {
  it('reaches the chart the deck draws from', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    const box = screen.getByRole('spinbutton', { name: 'Revenue, Q2' })
    await user.clear(box)
    await user.type(box, '99')
    await user.tab()

    await waitFor(() => {
      expect(valuesOf()[0]).toEqual([10.5, 99, 9.8, 18.1])
    })
  })

  it('leaves the other series where it was', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    const box = screen.getByRole('spinbutton', { name: 'Revenue, Q2' })
    await user.clear(box)
    await user.type(box, '99')
    await user.tab()

    await waitFor(() => {
      expect(valuesOf()[1]).toEqual([7.1, 8.4, 8.9, 10])
    })
  })

  it('changes the workbook Edit Data would open, not only the cache', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    const box = screen.getByRole('spinbutton', { name: 'Revenue, Q2' })
    await user.clear(box)
    await user.type(box, '99')
    await user.tab()

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

    const box = screen.getByRole('spinbutton', { name: 'Revenue, Q2' })
    await user.clear(box)
    await user.type(box, '99')
    await user.tab()
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

    const box = screen.getByRole('textbox', { name: 'Category 2' })
    await user.clear(box)
    await user.type(box, 'Spring')
    await user.tab()

    await waitFor(() => {
      expect(namesOf()).toEqual(['Q1', 'Spring', 'Q3', 'Q4'])
    })
  })

  it('renames the box the values are listed under too', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    const box = screen.getByRole('textbox', { name: 'Category 1' })
    await user.clear(box)
    await user.type(box, 'Spring')
    await user.tab()

    // The table's own row label is the category, so it follows.
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: 'Revenue, Spring' })).toBeInTheDocument()
    })
  })

  it('is one step to undo, cache and workbook together', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    const box = screen.getByRole('textbox', { name: 'Category 2' })
    await user.clear(box)
    await user.type(box, 'Spring')
    await user.tab()
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
  const rows = () => screen.getAllByRole('spinbutton', { name: /^Revenue, / }).length

  it('adds one to every series at once', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    const before = rows()

    await user.click(screen.getByRole('button', { name: 'Add a point' }))

    await waitFor(() => {
      expect(rows()).toBe(before + 1)
    })
    expect(valuesOf()[0]).toHaveLength(before + 1)
    expect(valuesOf()[1]).toHaveLength(before + 1)
  })

  it('takes one away from every series at once', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()
    const before = rows()

    await user.click(screen.getByRole('button', { name: 'Remove the last point' }))

    await waitFor(() => {
      expect(valuesOf()[0]).toHaveLength(before - 1)
    })
    expect(valuesOf()[1]).toHaveLength(before - 1)
  })

  it('moves the workbook’s rows with it', async () => {
    const user = userEvent.setup()
    render(<App />)
    pickChart()

    await user.click(screen.getByRole('button', { name: 'Add a point' }))

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
    const before = valuesOf()[0]?.length ?? 0

    await user.click(screen.getByRole('button', { name: 'Add a point' }))
    await waitFor(() => {
      expect(valuesOf()[0]).toHaveLength(before + 1)
    })

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(valuesOf()[0]).toHaveLength(before)
  })
})
