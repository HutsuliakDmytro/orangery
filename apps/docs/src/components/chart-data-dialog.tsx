import { NodeSelection } from '@tiptap/pm/state'
import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { DataGrid } from '@orangery/grid'
import { PickerPopover } from '@orangery/ui-kit'
import {
  allSeries,
  parseTypedNumber,
  readChart,
  writeCategoriesIn,
  writePointsIn,
  writeSeriesNameIn,
  writeValuesIn,
  writeXValuesIn,
} from '@orangery/charts'
import type { Chart } from '@orangery/charts'
import { useDocumentStore } from '../store/document-store'
import { closePicker, useOpenPicker } from '../editor/commands/picker-store'

/**
 * The numbers behind a chart in a document.
 *
 * The same grid the deck app opens, on the same package, and for the same
 * reason: a spreadsheet is a large answer to "make that bar taller".
 *
 * Edits go into the node, as every other chart edit in this app does. The
 * workbook the chart embeds is brought back into step when the document is
 * saved — see `writeCharts` in `docx-file` — so undo puts back the chart that
 * would be written rather than one of its two halves.
 */
export function ChartDataDialog() {
  const { editor } = useCurrentEditor()
  const picker = useOpenPicker()
  const markDirty = useDocumentStore((state) => state.markDirty)

  const position = useEditorState({
    editor: editor ?? null,
    selector: ({ editor: instance }) => {
      const selection = instance?.state.selection
      if (!(selection instanceof NodeSelection)) return null

      return selection.node.type.name === 'documentChart' ? selection.from : null
    },
  })

  if (editor === null || picker !== 'chart-data' || position === null) return null

  const xml: unknown = editor.state.doc.nodeAt(position)?.attrs['chart']
  const chart = typeof xml === 'string' ? readChart(xml) : null
  if (chart === null) return null

  const write = (edit: (current: string) => string | null) => {
    // Read from the node rather than from the render that opened the dialog:
    // two edits in a row would otherwise both start from the first one's text
    // and the second would undo the first.
    const current: unknown = editor.state.doc.nodeAt(position)?.attrs['chart']
    const written = typeof current === 'string' ? edit(current) : null
    if (written === null) return

    // Dispatched rather than run through a focusing chain: `focus()` would
    // pull the caret back into the document, taking it out of the cell being
    // typed in — and it lands in the history as a step of its own, so undoing
    // one edit would take two.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'chart', written))
    markDirty()
  }

  return <Editor chart={chart} onWrite={write} onClose={closePicker} />
}

function Editor({
  chart,
  onWrite,
  onClose,
}: {
  chart: Chart
  onWrite: (edit: (current: string) => string | null) => void
  onClose: () => void
}) {
  const series = allSeries(chart)
  const points = Math.max(chart.categories.length, ...series.map((one) => one.values.length), 0)

  // A scatter measures its bottom rather than naming it: its first column is
  // the x of each point, which is data like any other and is edited like it.
  const named = chart.categories.length > 0
  const across = named ? null : (series[0]?.xValues ?? null)

  /**
   * The table as the workbook behind the chart holds it.
   *
   * A header row, then a row per point. That is what "Edit Data" opens in
   * Word, and it is also the sheet this writes back to — so the editor is a
   * picture of the file rather than an arrangement of its own.
   */
  const value = ({ row, column }: { row: number; column: number }): string | null => {
    if (row === 0) return column === 0 ? null : (series[column - 1]?.name ?? null)

    const at = row - 1
    if (column === 0) {
      if (named) return chart.categories[at] ?? ''

      const x = across?.[at]
      return x === null || x === undefined ? null : String(x)
    }

    // A gap in a chart is a real thing and a blank is how it is written; read
    // as a nought it would be a bar where there is none.
    const point = series[column - 1]?.values[at]
    return point === null || point === undefined ? null : String(point)
  }

  const change = ({ row, column }: { row: number; column: number }, text: string) => {
    if (row === 0) {
      if (column > 0) {
        onWrite((current) => writeSeriesNameIn(current, { series: column - 1, name: text }))
      }
      return
    }

    const at = row - 1

    // Read by the package's own rules rather than by `Number`: half the world
    // types `1,5`, and `Number` calls that nothing at all. Empty is a gap,
    // and anything unreadable is refused rather than quietly turned into one.
    const number = () => parseTypedNumber(text)

    if (column === 0) {
      if (named) {
        onWrite((current) =>
          writeCategoriesIn(current, {
            categories: chart.categories.map((one, index) => (index === at ? text : one)),
          }),
        )
        return
      }

      const x = number()
      if (x === undefined || across === null) return

      onWrite((current) =>
        writeXValuesIn(current, {
          series: 0,
          xValues: across.map((held, index) => (index === at ? x : held)),
        }),
      )
      return
    }

    const one = series[column - 1]
    const wanted = number()
    if (one === undefined || wanted === undefined) return

    onWrite((current) =>
      writeValuesIn(current, {
        series: column - 1,
        // The other points as they are, gaps included: a value nobody touched
        // must not become a nought on its way past.
        values: one.values.map((held, index) => (index === at ? wanted : held)),
      }),
    )
  }

  return (
    <PickerPopover title="Chart data" onClose={onClose}>
      <div className="space-y-2 text-xs text-text">
        <DataGrid
          label="Chart data"
          // The header row is a row of the table, as it is in the workbook, so
          // the letters along the top are the sheet's own.
          rows={points + 1}
          columns={series.length + 1}
          width={Math.min(560, 44 + (series.length + 1) * 110)}
          height={Math.min(320, 22 + (points + 1) * 22 + 2)}
          metrics={{ columnWidth: 110 }}
          valueAt={value}
          editable={({ row, column }) =>
            row === 0 ? column > 0 : column > 0 || named || across !== null
          }
          onChange={change}
        />

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              onWrite((current) => writePointsIn(current, { at: points, insert: true }))
            }}
            className="rounded border border-border px-1.5 py-0.5 text-text hover:border-accent"
          >
            Add point
          </button>
          <button
            type="button"
            // A chart of one point is a chart of nothing; below that there is
            // no picture left to look at.
            disabled={points <= 1}
            onClick={() => {
              onWrite((current) => writePointsIn(current, { at: points - 1, insert: false }))
            }}
            className="rounded border border-border px-1.5 py-0.5 text-muted disabled:opacity-40"
          >
            Remove point
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}
