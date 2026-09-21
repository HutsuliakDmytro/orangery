import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorContext } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allSeries, readChart } from '@orangery/charts'
import { buildExtensions } from '../editor/extension-set'
import { requestPicker, resetPickers } from '../editor/commands/picker-store'
import { ChartDataDialog } from './chart-data-dialog'

/**
 * The numbers behind a chart in a document.
 *
 * The cells are drawn on a canvas, so they are reached the way a person
 * reaches them: by moving the selection and typing. Every assertion reads the
 * node back, because the node is what the save writes the part from.
 */

const CHART =
  '<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart>' +
  '<c:ser>' +
  '<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/>' +
  '<c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
  '<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$2</c:f><c:strCache><c:ptCount val="2"/>' +
  '<c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt>' +
  '</c:strCache></c:strRef></c:cat>' +
  '<c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/>' +
  '<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>' +
  '</c:numCache></c:numRef></c:val></c:ser>' +
  '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
  '<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx>' +
  '</c:plotArea></c:chart></c:chartSpace>'

let editor: Editor

beforeEach(() => {
  editor = new Editor({
    extensions: buildExtensions(),
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'documentChart',
              attrs: {
                relationshipId: 'rId9',
                width: 432,
                height: 252,
                drawing: '<w:drawing/>',
                chart: CHART,
                themeColors: [],
              },
            },
          ],
        },
      ],
    },
  })

  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
  requestPicker('chart-data')
})

afterEach(() => {
  resetPickers()
})

function Wrapper({ children }: { children: ReactNode }) {
  return <EditorContext.Provider value={{ editor }}>{children}</EditorContext.Provider>
}

/** The chart as the node holds it now. */
const chartNow = () => {
  const xml: unknown = editor.state.doc.nodeAt(1)?.attrs['chart']
  return readChart(typeof xml === 'string' ? xml : '')
}

const valuesNow = () => {
  const chart = chartNow()
  return chart === null ? [] : allSeries(chart).map((series) => series.values)
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

describe('the chart data dialog', () => {
  it('opens on the selected chart, a column per series', () => {
    render(<ChartDataDialog />, { wrapper: Wrapper })

    const grid = screen.getByRole('grid', { name: 'Chart data' })
    // Two points and the header row above them, as the workbook has it.
    expect(grid).toHaveAttribute('aria-rowcount', '3')
    expect(grid).toHaveAttribute('aria-colcount', '2')
  })

  it('is not there when no chart is selected', () => {
    editor.commands.setTextSelection(0)
    render(<ChartDataDialog />, { wrapper: Wrapper })

    expect(screen.queryByRole('grid', { name: 'Chart data' })).not.toBeInTheDocument()
  })

  it('writes a number into the node the save reads from', async () => {
    const user = userEvent.setup()
    render(<ChartDataDialog />, { wrapper: Wrapper })

    await typeInCell(user, { row: 2, column: 1 }, '99')

    await waitFor(() => {
      expect(valuesNow()[0]).toEqual([10, 99])
    })
  })

  it('renames a category', async () => {
    const user = userEvent.setup()
    render(<ChartDataDialog />, { wrapper: Wrapper })

    await typeInCell(user, { row: 1, column: 0 }, 'Spring')

    await waitFor(() => {
      expect(chartNow()?.categories).toEqual(['Spring', 'Q2'])
    })
  })

  it('renames a series in the header row, where the workbook keeps the name', async () => {
    const user = userEvent.setup()
    render(<ChartDataDialog />, { wrapper: Wrapper })

    await typeInCell(user, { row: 0, column: 1 }, 'Income')

    await waitFor(() => {
      const chart = chartNow()
      expect(chart === null ? [] : allSeries(chart).map((one) => one.name)).toEqual(['Income'])
    })
  })

  it('leaves a series that names itself nowhere alone', async () => {
    // Giving such a series a name means giving it a cell to keep it in, which
    // changes the shape of the workbook rather than its contents — a larger
    // edit than renaming, and not this one.
    const user = userEvent.setup()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'documentChart',
              attrs: {
                relationshipId: 'rId9',
                width: 432,
                height: 252,
                drawing: '<w:drawing/>',
                chart: CHART.replace(/<c:tx>.*?<\/c:tx>/u, ''),
                themeColors: [],
              },
            },
          ],
        },
      ],
    })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))

    render(<ChartDataDialog />, { wrapper: Wrapper })
    await typeInCell(user, { row: 0, column: 1 }, 'Income')

    const chart = chartNow()
    expect(chart === null ? [] : allSeries(chart).map((one) => one.name)).toEqual([null])
  })

  it('adds a point to every series at once', async () => {
    const user = userEvent.setup()
    render(<ChartDataDialog />, { wrapper: Wrapper })

    await user.click(screen.getByRole('button', { name: 'Add point' }))

    await waitFor(() => {
      expect(valuesNow()[0]).toHaveLength(3)
    })
  })

  it('is one step to undo, because the node is what changed', async () => {
    const user = userEvent.setup()
    render(<ChartDataDialog />, { wrapper: Wrapper })

    await typeInCell(user, { row: 1, column: 1 }, '55')
    await waitFor(() => {
      expect(valuesNow()[0]).toEqual([55, 20])
    })

    editor.commands.undo()
    expect(valuesNow()[0]).toEqual([10, 20])
  })
})

describe('a scatter, which measures its bottom', () => {
  const SCATTER =
    '<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:scatterChart><c:ser>' +
    '<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$3</c:f><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>0.7</c:v></c:pt><c:pt idx="1"><c:v>1.8</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:xVal>' +
    '<c:yVal><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:yVal></c:ser>' +
    '<c:axId val="1"/><c:axId val="2"/></c:scatterChart>' +
    '<c:valAx><c:axId val="1"/></c:valAx><c:valAx><c:axId val="2"/></c:valAx>' +
    '</c:plotArea></c:chart></c:chartSpace>'

  const openScatter = () => {
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'documentChart',
              attrs: {
                relationshipId: 'rId9',
                width: 432,
                height: 252,
                drawing: '<w:drawing/>',
                chart: SCATTER,
                themeColors: [],
              },
            },
          ],
        },
      ],
    })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
    render(<ChartDataDialog />, { wrapper: Wrapper })
  }

  it('shows the x of each point rather than counting them', async () => {
    const user = userEvent.setup()
    openScatter()

    await user.click(screen.getByRole('grid', { name: 'Chart data' }))
    await user.keyboard('{ArrowUp>10/}{ArrowLeft>10/}{ArrowDown}')

    // A1 is the corner; A2 is the first x, which is data and not a label.
    expect(screen.getByRole('grid', { name: 'Chart data' }).textContent).toContain('A, row 2: 0.7')
  })

  it('moves a point along the bottom when its x is typed over', async () => {
    const user = userEvent.setup()
    openScatter()

    await typeInCell(user, { row: 1, column: 0 }, '5')

    await waitFor(() => {
      const chart = chartNow()
      expect(chart === null ? [] : allSeries(chart)[0]?.xValues).toEqual([5, 1.8])
    })
  })

  it('leaves the height of the point where it was', async () => {
    const user = userEvent.setup()
    openScatter()

    await typeInCell(user, { row: 1, column: 0 }, '5')

    await waitFor(() => {
      const chart = chartNow()
      expect(chart === null ? [] : allSeries(chart)[0]?.values).toEqual([10, 20])
    })
  })
})
