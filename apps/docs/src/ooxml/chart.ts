import { attribute, findChild, findDescendant, serializeNode } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { emuToPoints } from '@orangery/ooxml-drawingml'
import type { ProseMirrorNodeJson } from './prosemirror-json'

/**
 * A chart in a document.
 *
 * It arrives the same way a picture does — inside a `w:drawing` — and differs
 * in what the `a:graphicData` holds: a relationship id pointing at a chart part
 * rather than a `a:blip` pointing at an image. Everything that makes it a chart
 * lives in that part, which this never touches.
 *
 * The whole `w:drawing` is kept and written back as it was. Nothing here
 * resizes or edits a chart, so there is no path by which the original could be
 * improved upon, and every other property of the frame — the wrap, the anchor,
 * the effects — is preserved by not being regenerated.
 */

/** `a:graphicData` uris: the older charts and the 2016 ones, which we only frame. */
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHART_EX_URI = 'http://schemas.microsoft.com/office/drawing/2014/chartex'

export interface ChartAttributes {
  /** Into `word/_rels/document.xml.rels`, pointing at the chart part. */
  relationshipId: string
  /** Display size in points, which is what the rest of the document is in. */
  width: number
  height: number
  /** The original `w:drawing`, written back untouched. */
  drawing: string
}

export function parseChartDrawing(drawing: XmlNode): ChartAttributes | null {
  const container = findChild(drawing, 'wp:inline') ?? findChild(drawing, 'wp:anchor')
  if (container === undefined) return null

  const data = findDescendant(container, 'a:graphicData')
  const uri = data === undefined ? undefined : attribute(data, 'uri')
  if (uri !== CHART_URI && uri !== CHART_EX_URI) return null

  // `c:chart` for a chart, `cx:chart` for one of the 2016 kinds, which is read
  // far enough to be framed and named.
  const reference = findChild(data ?? {}, 'c:chart') ?? findChild(data ?? {}, 'cx:chart')
  const relationshipId = reference === undefined ? undefined : attribute(reference, 'r:id')
  if (relationshipId === undefined) return null

  const extent = findChild(container, 'wp:extent')
  const width = Number(extent === undefined ? NaN : attribute(extent, 'cx'))
  const height = Number(extent === undefined ? NaN : attribute(extent, 'cy'))

  return {
    relationshipId,
    width: Number.isFinite(width) ? emuToPoints(width) : 0,
    height: Number.isFinite(height) ? emuToPoints(height) : 0,
    drawing: serializeNode(drawing),
  }
}

/**
 * The chart as the editor holds it.
 *
 * The part's XML travels in the node rather than being fetched when it is
 * drawn: the package is open at the moment a document is parsed and not
 * afterwards, and a chart that had to reach for it would render as an empty
 * frame in every document reopened from a crash snapshot.
 *
 * `themeColors` are the document theme's slots resolved to hexes, for the same
 * reason. They are what the chart is coloured by when it names no colour of
 * its own, which is the ordinary case.
 */
export function chartNode(
  chart: ChartAttributes,
  xml: string | null,
  themeColors: readonly (readonly [string, string])[],
): ProseMirrorNodeJson {
  return {
    type: 'documentChart',
    attrs: {
      relationshipId: chart.relationshipId,
      width: chart.width,
      height: chart.height,
      drawing: chart.drawing,
      chart: xml,
      themeColors: themeColors.map(([slot, hex]) => [slot, hex]),
    },
  }
}
