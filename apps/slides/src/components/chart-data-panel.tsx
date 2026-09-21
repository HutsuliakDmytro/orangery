import { ChartProperties, allSeries, readChart, themeAccents } from '@orangery/charts'
import { getPartText } from '@orangery/ooxml-core'
import { colorContextFor, themeFor } from '@orangery/ooxml-presentation'
import { chartPartOf, editChartProperties } from '../document/chart-editing'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * What the properties panel says about a chart.
 *
 * Not the numbers themselves: those are a table, and a table in a strip this
 * narrow is a table nobody can read. The panel says what the chart is made of
 * and opens the editor, which is what PowerPoint's own button does.
 */
export function ChartDataPanel() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const selection = useDeckStore((state) => state.selection)
  const editData = useViewStore((state) => state.setEditingChartData)

  if (open === null || slide === null || selection.length !== 1) return null

  const shape = slide.shapes.find((one) => selection.includes(one.id))
  if (shape?.graphic?.kind !== 'chart') return null

  const part = chartPartOf(shape, slide.path)
  const chart = part === null ? null : readChart(getPartText(open.package, part) ?? '')
  if (part === null || chart === null) return null

  const series = allSeries(chart)
  const points = Math.max(chart.categories.length, ...series.map((one) => one.values.length), 0)

  // The colours the canvas is drawing this chart in, so the panel shows what
  // is there rather than what a series would have if it stated one.
  const palette = themeAccents(
    themeFor(open.deck, open.themes, slide),
    colorContextFor(open.deck, open.themes, slide),
  )

  return (
    <section aria-label="Chart" className="space-y-2 text-xs">
      <h2 className="uppercase tracking-wide text-muted">Chart</h2>

      <p className="text-muted">
        {series.length === 1 ? '1 series' : `${String(series.length)} series`},{' '}
        {points === 1 ? '1 point' : `${String(points)} points`}
      </p>

      <button
        type="button"
        onClick={() => {
          editData(true)
        }}
        className="rounded border border-border px-1.5 py-0.5 text-text hover:border-accent"
      >
        Edit data
      </button>

      <ChartProperties
        // Rebuilt when the chart changes, so the boxes that are only read on
        // mount start from what the file says now.
        key={`${part}:${String(series.length)}:${String(points)}`}
        chart={chart}
        palette={palette}
        onEdit={(edits) => {
          editChartProperties(part, edits)
        }}
      />
    </section>
  )
}
