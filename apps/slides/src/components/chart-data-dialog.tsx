import { DataGrid } from '@orangery/grid'
import { PickerPopover } from '@orangery/ui-kit'
import { allSeries, parseTypedNumber, readChart } from '@orangery/charts'
import type { Chart } from '@orangery/charts'
import { getPartText } from '@orangery/ooxml-core'
import {
  chartPartOf,
  editChartCategories,
  editChartPoints,
  editChartSeriesName,
  editChartValues,
  editChartXValues,
} from '../document/chart-editing'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * The numbers behind a chart, as a sheet.
 *
 * PowerPoint opens Excel for this. Here the table opens in place, on the same
 * grid the spreadsheet app will be built from — four columns of it today, a
 * worksheet later, and one implementation so the two cannot drift.
 *
 * The first column is the categories and the rest are the series, which is how
 * the workbook behind the chart is laid out and therefore what somebody
 * expects to see.
 */

export function ChartDataDialog() {
  const showing = useViewStore((state) => state.editingChartData)
  const setShowing = useViewStore((state) => state.setEditingChartData)
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const selection = useDeckStore((state) => state.selection)

  if (!showing || open === null || slide === null) return null

  const shape = slide.shapes.find((one) => selection.includes(one.id))
  const part = shape === undefined ? null : chartPartOf(shape, slide.path)
  const chart = part === null ? null : readChart(getPartText(open.package, part) ?? '')
  if (part === null || chart === null) return null

  return (
    <Editor
      chart={chart}
      part={part}
      onClose={() => {
        setShowing(false)
      }}
    />
  )
}

function Editor({ chart, part, onClose }: { chart: Chart; part: string; onClose: () => void }) {
  const series = allSeries(chart)
  const points = Math.max(chart.categories.length, ...series.map((one) => one.values.length), 0)

  // A scatter measures its bottom rather than naming it: its first column is
  // the x of each point, which is data like any other and is edited like it.
  const named = chart.categories.length > 0
  const across = named ? null : (series[0]?.xValues ?? null)

  /**
   * The table as the workbook behind the chart holds it.
   *
   * A header row, then a row per point: names down the first column, a column
   * of numbers per series. That is what "Edit Data" opens in Office, and it is
   * also literally the sheet this writes back to — so the editor is a picture
   * of the file rather than an arrangement of its own.
   */
  const value = ({ row, column }: { row: number; column: number }): string | null => {
    if (row === 0) return column === 0 ? null : (series[column - 1]?.name ?? null)

    const at = row - 1
    if (column === 0) {
      if (named) return chart.categories[at] ?? ''

      const x = across?.[at]
      return x === null || x === undefined ? null : String(x)
    }

    // A gap in a chart is a real thing, and a blank is how it is written. Read
    // as a nought it would be a bar where there is none.
    const point = series[column - 1]?.values[at]
    return point === null || point === undefined ? null : String(point)
  }

  const change = ({ row, column }: { row: number; column: number }, text: string) => {
    if (row === 0) {
      if (column > 0) void editChartSeriesName(part, { series: column - 1, name: text })
      return
    }

    const at = row - 1

    // Read by the package's own rules rather than by `Number`: half the world
    // types `1,5`, and `Number` calls that nothing at all. Empty is a gap,
    // and anything unreadable is refused rather than quietly turned into one.
    const number = () => parseTypedNumber(text)

    if (column === 0) {
      if (named) {
        void editChartCategories(part, {
          categories: chart.categories.map((one, index) => (index === at ? text : one)),
        })
        return
      }

      const wanted = number()
      if (wanted === undefined || across === null) return

      void editChartXValues(part, {
        series: 0,
        xValues: across.map((held, index) => (index === at ? wanted : held)),
      })
      return
    }

    const one = series[column - 1]
    const wanted = number()
    if (one === undefined || wanted === undefined) return

    void editChartValues(part, {
      series: column - 1,
      // The other points as they are, gaps included: a value nobody
      // touched must not become a nought on its way past.
      values: one.values.map((held, index) => (index === at ? wanted : held)),
    })
  }

  return (
    <PickerPopover title="Chart data" onClose={onClose}>
      <div className="space-y-2 text-xs text-text">
        <DataGrid
          label="Chart data"
          // The header row is a row of the table, as it is in the workbook, so
          // the letters down the top are the sheet's own.
          rows={points + 1}
          columns={series.length + 1}
          width={Math.min(560, 44 + (series.length + 1) * 110)}
          height={Math.min(320, 22 + (points + 1) * 22 + 2)}
          metrics={{ columnWidth: 110 }}
          valueAt={value}
          // The corner of a table belongs to neither the names nor the
          // numbers, which is how Office leaves it too.
          // The corner of a table belongs to neither the names nor the
          // numbers, which is how Office leaves it too. The first column is
          // typed into when it holds something — names, or a scatter's x.
          editable={({ row, column }) =>
            row === 0 ? column > 0 : column > 0 || named || across !== null
          }
          onChange={change}
        />

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              void editChartPoints(part, { at: points, insert: true })
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
              void editChartPoints(part, { at: points - 1, insert: false })
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
