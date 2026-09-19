import { insertChart } from '@orangery/ooxml-presentation'
import { writePackage } from '@orangery/ooxml-core'
import { chartTitleFor, defaultChartData, newChartPart, newChartWorkbook } from '@orangery/charts'
import type { NewChartKind } from '@orangery/charts'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * Putting a new chart on the slide.
 *
 * Asynchronous because the workbook beside the chart is a zip, and a zip has
 * to be written before it can be a part. The whole insertion is one edit all
 * the same: the chart, the workbook, the relationships and the frame go in
 * together, because a deck holding three of the four is one PowerPoint
 * offers to repair.
 */
export async function insertChartOnSlide(kind: NewChartKind): Promise<boolean> {
  const { open, edit, selectShapes } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null) return false

  const workbook = await writePackage(newChartWorkbook(defaultChartData(kind)))
  const size = open.deck.slideSize

  // The size PowerPoint gives a new chart: most of the slide, centred, and
  // short enough that a title above it still has room.
  const width = size.width * 0.72
  const height = size.height * 0.6
  const made: { id: number | null } = { id: null }

  edit((edited) => {
    made.id = insertChart(open.package, edited, {
      xml: newChartPart(kind),
      workbook,
      name: chartTitleFor(kind),
      transform: {
        x: (size.width - width) / 2,
        y: (size.height - height) / 2,
        width,
        height,
      },
    })

    return made.id !== null
  })

  if (made.id !== null) selectShapes([made.id])
  return made.id !== null
}
