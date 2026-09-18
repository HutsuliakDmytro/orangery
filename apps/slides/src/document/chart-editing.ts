import { patchedWorkbook, relationshipTarget, writeChartCache } from '@orangery/ooxml-presentation'
import type { ChartValues, Shape } from '@orangery/ooxml-presentation'
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

export async function editChartValues(part: string, change: ChartValues): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  const workbook = await patchedWorkbook(open.package, part, change)

  useDeckStore.getState().editPackage((deck) => {
    const cached = writeChartCache(deck.package, part, change)
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
