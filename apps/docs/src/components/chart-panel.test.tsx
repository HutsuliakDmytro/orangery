import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorContext } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readChart } from '@orangery/charts'
import { buildExtensions } from '../editor/extension-set'
import { ChartPanel } from './chart-panel'

/**
 * The chart panel in a document.
 *
 * The edit goes into the node, not into the package: the node is what the undo
 * history holds and what the save writes the part from, so a test that reads
 * the node back is reading what would be saved.
 */

const CHART =
  '<c:chartSpace xmlns:c="c"><c:chart><c:plotArea>' +
  '<c:barChart><c:barDir val="col"/><c:ser><c:val><c:numRef><c:numCache>' +
  '<c:ptCount val="1"/><c:pt idx="0"><c:v>5</c:v></c:pt>' +
  '</c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
  '<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx>' +
  '</c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>'

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
})

/** The panel, with the editor the test built behind it. */
function Wrapper({ children }: { children: ReactNode }) {
  return <EditorContext.Provider value={{ editor }}>{children}</EditorContext.Provider>
}

/** Selects the chart, which is what makes the panel appear. */
const selectChart = () => {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
}

/** The chart as the node holds it now. */
const chartNow = () => {
  const xml: unknown = editor.state.doc.nodeAt(1)?.attrs['chart']
  return readChart(typeof xml === 'string' ? xml : '')
}

describe('the chart panel', () => {
  it('is not there until a chart is selected', () => {
    render(<ChartPanel />, { wrapper: Wrapper })
    expect(screen.queryByRole('combobox', { name: 'Chart type' })).not.toBeInTheDocument()
  })

  it('shows what the selected chart is', async () => {
    render(<ChartPanel />, { wrapper: Wrapper })
    selectChart()

    expect(await screen.findByRole('combobox', { name: 'Chart type' })).toHaveValue('bar')
    expect(screen.getByRole('combobox', { name: 'Legend' })).toHaveValue('b')
  })

  it('writes an edit into the node the save reads from', async () => {
    const user = userEvent.setup()
    render(<ChartPanel />, { wrapper: Wrapper })
    selectChart()

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Legend' }), 't')

    await waitFor(() => {
      expect(chartNow()?.legend).toBe('t')
    })
  })

  it('changes the kind without touching the numbers', async () => {
    const user = userEvent.setup()
    render(<ChartPanel />, { wrapper: Wrapper })
    selectChart()

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Chart type' }), 'line')

    await waitFor(() => {
      expect(chartNow()?.plots[0]?.kind).toBe('line')
    })
    expect(chartNow()?.plots[0]?.series[0]?.values).toEqual([5])
  })

  it('is one step to undo, because the node is what changed', async () => {
    const user = userEvent.setup()
    render(<ChartPanel />, { wrapper: Wrapper })
    selectChart()

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Legend' }), 't')
    await waitFor(() => {
      expect(chartNow()?.legend).toBe('t')
    })

    editor.commands.undo()
    expect(chartNow()?.legend).toBe('b')
  })
})
