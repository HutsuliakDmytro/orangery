import { allSeries, readChart } from '@orangery/ooxml-drawingml'
import { getPartText } from '@orangery/ooxml-core'
import { chartPartOf, editChartCategories, editChartValues } from '../document/chart-editing'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * The numbers behind a chart, as a table.
 *
 * A chart is a picture of some data, and the way to change the picture is to
 * change the data. PowerPoint opens Excel for this; here the numbers are in
 * the panel, because a spreadsheet is a large answer to "make that bar taller".
 *
 * The values and the names. Adding a point is not here: it moves every range
 * the chart names in `c:f`, which is a different operation from putting a new
 * value in a cell that already exists.
 */
export function ChartDataPanel() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const selection = useDeckStore((state) => state.selection)

  if (open === null || slide === null || selection.length !== 1) return null

  const shape = slide.shapes.find((one) => selection.includes(one.id))
  if (shape?.graphic?.kind !== 'chart') return null

  const part = chartPartOf(shape, slide.path)
  const chart = part === null ? null : readChart(getPartText(open.package, part) ?? '')
  if (part === null || chart === null) return null

  const series = allSeries(chart)
  if (series.length === 0) return null

  return (
    <section aria-label="Chart data" className="space-y-2 text-xs">
      <h2 className="uppercase tracking-wide text-muted">Chart data</h2>

      <table className="w-full">
        <thead>
          <tr>
            <th className="w-1/3 text-left font-normal text-muted">Category</th>
            {series.map((one, index) => (
              <th key={index} className="truncate text-left font-normal text-muted">
                {one.name ?? `Series ${String(index + 1)}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(chart.categories.length > 0
            ? chart.categories
            : (series[0]?.values ?? []).map((_, index) => `Point ${String(index + 1)}`)
          ).map((category, row) => (
            <tr key={row}>
              <td className="pr-1">
                {chart.categories.length === 0 ? (
                  // A scatter numbers its own bottom; there is no name to edit.
                  <span className="text-muted">{category}</span>
                ) : (
                  <input
                    type="text"
                    aria-label={`Category ${String(row + 1)}`}
                    defaultValue={category}
                    onBlur={(event) => {
                      const names = chart.categories.map((one, at) =>
                        at === row ? event.target.value : one,
                      )
                      void editChartCategories(part, { categories: names })
                    }}
                    className="w-full rounded border border-border bg-transparent px-1 py-0.5 text-text outline-none focus:border-accent"
                  />
                )}
              </td>
              {series.map((one, index) => (
                <td key={index} className="pr-1">
                  <input
                    type="number"
                    aria-label={`${one.name ?? `Series ${String(index + 1)}`}, ${category}`}
                    // A gap in a chart is a real thing and an empty box is how
                    // it is written; it is left as it was rather than read as
                    // a zero, which would be a bar where there is none.
                    defaultValue={one.values[row] ?? ''}
                    onBlur={(event) => {
                      const wanted = Number(event.target.value)
                      if (!Number.isFinite(wanted)) return

                      const values = one.values.map((value, at) =>
                        at === row ? wanted : (value ?? 0),
                      )
                      void editChartValues(part, { series: index, values })
                    }}
                    className="w-full rounded border border-border bg-transparent px-1 py-0.5 text-text outline-none focus:border-accent"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
