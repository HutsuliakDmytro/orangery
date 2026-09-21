import {
  applyChartEdits,
  patchedWorkbook,
  patchedWorkbookRows,
  writeChartCache,
  writeChartCategories,
  writeChartPoints,
  writeChartSeriesName,
  writeChartXValues,
} from '@orangery/charts'
import type {
  ChartCategories,
  ChartEdit,
  ChartSeriesName,
  ChartValues,
  ChartXValues,
} from '@orangery/charts'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import { relationshipTarget } from '@orangery/ooxml-presentation'
import type { Shape } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'

/**
 * Putting a new number into a chart.
 *
 * Both halves in one edit: the cache the chart is drawn from and the workbook
 * "Edit Data" opens. Separately, they would be two steps in the undo history
 * for one change, and undoing one of them would leave a chart whose two
 * answers disagree.
 *
 * The workbook is a zip and has to be opened, so the work is done first and the
 * edit applied after — which is also why this is asynchronous while nothing
 * else that changes a shape is.
 */

/** The chart part a graphic frame points at, or null. */
export function chartPartOf(shape: Shape, slidePath: string): string | null {
  const id = shape.graphic?.relationshipId
  const { open } = useDeckStore.getState()
  if (id == null || open === null) return null

  return relationshipTarget(open.package, slidePath, id)
}

/**
 * Changes a chart, in the cache and in the workbook, as one edit.
 *
 * The same shape of work whether the change is a number or a name: what
 * differs is which cache is patched, and both halves have to move together or
 * PowerPoint rebuilds one from the other.
 */
async function edit(
  part: string,
  change: ChartValues | ChartCategories | ChartSeriesName | ChartXValues,
): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  const workbook = await patchedWorkbook(open.package, part, change)

  useDeckStore.getState().editPackage((deck) => {
    const cached =
      'values' in change
        ? writeChartCache(deck.package, part, change)
        : 'xValues' in change
          ? writeChartXValues(deck.package, part, change)
          : 'name' in change
            ? writeChartSeriesName(deck.package, part, change)
            : writeChartCategories(deck.package, part, change)

    if (workbook !== null) {
      deck.package.parts.set(workbook.path, {
        path: workbook.path,
        bytes: workbook.bytes,
        date: new Date(),
      })
    }

    return cached || workbook !== null
  })
}

export const editChartValues = (part: string, change: ChartValues) => edit(part, change)

export const editChartCategories = (part: string, change: ChartCategories) => edit(part, change)

export const editChartSeriesName = (part: string, change: ChartSeriesName) => edit(part, change)

export const editChartXValues = (part: string, change: ChartXValues) => edit(part, change)

/**
 * Adds a point to a chart, or takes one away.
 *
 * The same two halves as any other change, and the same reason for doing them
 * together — but this one moves the ranges as well, so the workbook's rows and
 * the chart's caches have to agree about how many there are.
 */
export async function editChartPoints(
  part: string,
  change: { at: number; insert: boolean },
): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  const workbook = await patchedWorkbookRows(open.package, part, change)

  useDeckStore.getState().editPackage((deck) => {
    const written = writeChartPoints(deck.package, part, change)
    if (workbook !== null) {
      deck.package.parts.set(workbook.path, {
        path: workbook.path,
        bytes: workbook.bytes,
        date: new Date(),
      })
    }

    return written || workbook !== null
  })
}

/**
 * Changes what a chart is, rather than what it says.
 *
 * The type, the legend, the labels, the scale, a series' colour: all of it is
 * inside the chart part and none of it is in the workbook, so unlike a number
 * this is one file to write and there is nothing to keep in step.
 */
export function editChartProperties(part: string, edits: readonly ChartEdit[]): void {
  useDeckStore.getState().editPackage((deck) => {
    const written = applyChartEdits(getPartText(deck.package, part) ?? '', edits)
    if (written === null) return false

    setPartText(deck.package, part, written)
    return true
  })
}
