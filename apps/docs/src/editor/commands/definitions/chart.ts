import type { Command } from '@orangery/ui-kit'
import type { NewChartKind } from '@orangery/charts'
import { chartActions } from '../chart-actions'
import { requestPicker } from '../picker-store'

/**
 * A chart of each kind, as five commands rather than one and a gallery.
 *
 * Typing "pie" in the palette reaches a pie chart in one gesture, and the kind
 * is a control in the chart panel afterwards — so nothing chosen here is
 * final.
 */
const KINDS: [NewChartKind, string][] = [
  ['bar', 'Column Chart'],
  ['line', 'Line Chart'],
  ['pie', 'Pie Chart'],
  ['area', 'Area Chart'],
  ['scatter', 'Scatter Chart'],
]

export const chartCommands: readonly Command[] = [
  ...KINDS.map(([kind, label]): Command => ({
    id: `insert.chart.${kind}`,
    label,
    group: 'insert',
    keywords: ['chart', 'graph', 'data', 'figure'],
    run: ({ editor }) => {
      void chartActions.insert(editor, kind)
    },
  })),
  {
    id: 'insert.chart-data',
    label: 'Edit Chart Data…',
    group: 'insert',
    keywords: ['chart', 'numbers', 'table', 'values'],
    isEnabled: ({ editor }) => editor.isActive('documentChart'),
    run: () => {
      requestPicker('chart-data')
    },
  },
]
