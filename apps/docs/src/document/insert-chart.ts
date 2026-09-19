import {
  addRelationship,
  ensureContentType,
  ensureOverride,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { pointsToEmu } from '@orangery/ooxml-drawingml'
import { chartTitleFor, defaultChartData, newChartPart, newChartWorkbook } from '@orangery/charts'
import type { NewChartKind } from '@orangery/charts'
import { writePackage } from '@orangery/ooxml-core'
import { themeColorsOf } from './docx-file'

/**
 * Putting a chart into a document.
 *
 * The same four things a deck needs — a part, an embedded workbook, two
 * relationships and the markup that points at them — with `w:drawing` in place
 * of `p:graphicFrame`. The parts go into the package before the node is
 * inserted: a node pointing at a relationship that does not exist is a file
 * Word offers to repair.
 */

const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHART_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
const PACKAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package'

const CHART_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
const WORKBOOK_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const DOCUMENT_RELS = 'word/_rels/document.xml.rels'

/** The first unused part of a kind, counting from one as Office does. */
function nextNumber(pkg: OoxmlPackage, pattern: RegExp): number {
  const used = [...pkg.parts.keys()].flatMap((path) => {
    const match = pattern.exec(path)
    return match?.[1] === undefined ? [] : [Number(match[1])]
  })

  return Math.max(0, ...used) + 1
}

export interface InsertedChart {
  relationshipId: string
  /** The `w:drawing` that goes in the run, as XML. */
  drawing: string
  /** The chart part, which the node carries so it can be drawn and saved. */
  chart: string
  width: number
  height: number
  themeColors: (readonly [string, string])[]
}

/**
 * Adds the parts a chart needs and returns what the node needs to find them.
 *
 * Asynchronous because the workbook beside the chart is a zip, and a zip has to
 * be written before it can be a part.
 */
export async function addChart(
  pkg: OoxmlPackage,
  kind: NewChartKind,
  size: { width: number; height: number },
  id: number,
): Promise<InsertedChart> {
  const number = nextNumber(pkg, /^word\/charts\/chart(\d+)\.xml$/u)
  const chartPath = `word/charts/chart${String(number)}.xml`
  const workbookNumber = nextNumber(pkg, /^word\/embeddings\/Microsoft_Excel_Sheet(\d+)\.xlsx$/u)
  const workbookName = `Microsoft_Excel_Sheet${String(workbookNumber)}.xlsx`

  const chart = newChartPart(kind)
  setPartText(pkg, chartPath, chart)
  ensureOverride(pkg, chartPath, CHART_CONTENT_TYPE)

  const workbook = await writePackage(newChartWorkbook(defaultChartData(kind)))
  const workbookPath = `word/embeddings/${workbookName}`
  pkg.parts.set(workbookPath, { path: workbookPath, bytes: workbook, date: new Date() })
  ensureContentType(pkg, 'xlsx', WORKBOOK_CONTENT_TYPE)

  // The chart part was written expecting its workbook at `rId1`.
  const chartRels = parseRelationships('')
  addRelationship(chartRels, PACKAGE_RELATIONSHIP, `../embeddings/${workbookName}`)
  setPartText(
    pkg,
    `word/charts/_rels/chart${String(number)}.xml.rels`,
    serializeRelationships(chartRels),
  )

  const documentRels = parseRelationships(getPartText(pkg, DOCUMENT_RELS) ?? '')
  const relationship = addRelationship(
    documentRels,
    CHART_RELATIONSHIP,
    `charts/chart${String(number)}.xml`,
  )
  setPartText(pkg, DOCUMENT_RELS, serializeRelationships(documentRels))

  return {
    relationshipId: relationship.id,
    drawing: drawingFor(relationship.id, size, id, chartTitleFor(kind)),
    chart,
    width: size.width,
    height: size.height,
    themeColors: themeColorsOf(pkg),
  }
}

/**
 * The `w:drawing` a chart sits in.
 *
 * Inline, because a chart in a document is a block somebody put between two
 * paragraphs far more often than a picture text runs around — and a floating
 * one is an anchor with wrapping this editor does not move yet.
 */
function drawingFor(
  relationshipId: string,
  size: { width: number; height: number },
  id: number,
  name: string,
): string {
  const cx = String(Math.round(pointsToEmu(size.width)))
  const cy = String(Math.round(pointsToEmu(size.height)))

  return (
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${String(id)}" name="${name}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    `<a:graphicData uri="${CHART_URI}">` +
    `<c:chart xmlns:c="${CHART_URI}" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    `r:id="${relationshipId}"/>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
  )
}
