import {
  addRelationship,
  children,
  element,
  ensureContentType,
  ensureOverride,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import { relsPartFor } from './insert-picture'

/**
 * Putting a chart on a slide.
 *
 * A chart is four things at once: a part of its own holding `c:chartSpace`, a
 * workbook embedded beside it that "Edit Data" opens, a relationship from the
 * slide to the first and from the first to the second, and a `p:graphicFrame`
 * on the slide that says where it goes. Any one of them missing is a file
 * PowerPoint offers to repair, so they are made together or not at all.
 *
 * What the chart *is* — its kind, its numbers, its legend — is not decided
 * here. The caller hands over the part it wants and this puts it in the
 * package, which keeps the chart vocabulary out of the deck's own package.
 */

const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHART_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
const PACKAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package'

const CHART_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
const WORKBOOK_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface NewChart {
  /** The `c:chartSpace` part, already built. */
  xml: string
  /** The embedded workbook, as the bytes of a zip. */
  workbook: Uint8Array
  /** In EMU. */
  transform: { x: number; y: number; width: number; height: number }
  /** What the frame is called in the selection pane. */
  name?: string
}

/** The first unused `chartN.xml`, counting from one as PowerPoint does. */
function nextChartNumber(pkg: OoxmlPackage): number {
  const used = [...pkg.parts.keys()].flatMap((path) => {
    const match = /^ppt\/charts\/chart(\d+)\.xml$/u.exec(path)
    return match?.[1] === undefined ? [] : [Number(match[1])]
  })

  return Math.max(0, ...used) + 1
}

/** The first unused embedded workbook, named the way Office names them. */
function nextWorkbookNumber(pkg: OoxmlPackage): number {
  const used = [...pkg.parts.keys()].flatMap((path) => {
    const match = /^ppt\/embeddings\/Microsoft_Excel_Sheet(\d+)\.xlsx$/u.exec(path)
    return match?.[1] === undefined ? [] : [Number(match[1])]
  })

  return Math.max(0, ...used) + 1
}

export function insertChart(pkg: OoxmlPackage, part: SlidePart, chart: NewChart): number | null {
  if (chart.transform.width <= 0 || chart.transform.height <= 0) return null

  const number = nextChartNumber(pkg)
  const chartPath = `ppt/charts/chart${String(number)}.xml`
  const workbookPath = `ppt/embeddings/Microsoft_Excel_Sheet${String(nextWorkbookNumber(pkg))}.xlsx`

  setPartText(pkg, chartPath, chart.xml)
  ensureOverride(pkg, chartPath, CHART_CONTENT_TYPE)

  pkg.parts.set(workbookPath, { path: workbookPath, bytes: chart.workbook, date: new Date() })
  ensureContentType(pkg, 'xlsx', WORKBOOK_CONTENT_TYPE)

  // The chart names its workbook `rId1`, which is what the part this writes
  // was built expecting.
  const chartRels = parseRelationships('')
  addRelationship(
    chartRels,
    PACKAGE_RELATIONSHIP,
    `../embeddings/${workbookPath.split('/').pop() ?? ''}`,
  )
  setPartText(pkg, relsPartFor(chartPath), serializeRelationships(chartRels))

  const slideRels = parseRelationships(getPartText(pkg, relsPartFor(part.path)) ?? '')
  const relationship = addRelationship(
    slideRels,
    CHART_RELATIONSHIP,
    `../charts/chart${String(number)}.xml`,
  )
  setPartText(pkg, relsPartFor(part.path), serializeRelationships(slideRels))

  const id = nextShapeId(part)
  const round = (value: number) => String(Math.round(value))

  const node = element('p:graphicFrame', {}, [
    element('p:nvGraphicFramePr', {}, [
      element('p:cNvPr', { id: String(id), name: chart.name ?? `Chart ${String(id)}` }),
      // A chart cannot be part of a group, which PowerPoint states here.
      element('p:cNvGraphicFramePr', {}, [element('a:graphicFrameLocks', { noGrp: '1' })]),
      element('p:nvPr'),
    ]),
    element('p:xfrm', {}, [
      element('a:off', { x: round(chart.transform.x), y: round(chart.transform.y) }),
      element('a:ext', { cx: round(chart.transform.width), cy: round(chart.transform.height) }),
    ]),
    element('a:graphic', {}, [
      element('a:graphicData', { uri: CHART_URI }, [
        element('c:chart', {
          'xmlns:c': CHART_URI,
          'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'r:id': relationship.id,
        }),
      ]),
    ]),
  ])

  children(part.tree).push(node)
  return id
}
