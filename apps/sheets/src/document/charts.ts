import {
  addRelationship,
  ensureOverride,
  getPartText,
  parseRelationships,
  partDirectory,
  resolveTarget,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import {
  drawingRelationshipId,
  EMU_PER_POINT,
  formatReference,
  readSheetDrawings,
  replaceDrawingReference,
  writeSheetDrawings,
} from '@orangery/ooxml-spreadsheet'
import type { SheetDrawing } from '@orangery/ooxml-spreadsheet'
import { addMedia } from '@orangery/ooxml-core'
import { imageSize } from '@orangery/ooxml-drawingml'
import { newChartPart } from '@orangery/charts'
import type { ChartData, NewChartKind, SheetSource } from '@orangery/charts'
import type { GridRange } from '@orangery/grid'
import { shownText } from './shown'
import { looksLikeHeader } from './sort'
import type { AnchoredDrawing, OpenSheet, OpenWorkbook } from './workbook'

/**
 * A chart made from cells on a sheet.
 *
 * The difference from a chart in a document or a slide is one thing said
 * twice: it points at the sheet rather than at a little workbook of its own
 * (`c:f` naming real cells, no `c:externalData`), and it is therefore the
 * only kind of chart whose numbers can change without anybody opening it.
 *
 * Four parts have to agree before one appears: the chart itself, the drawing
 * that positions it, the relationships between them, and the content types
 * that say what each one is. A file where any of those four disagrees is a
 * file Excel offers to repair, which is why they are written together here
 * rather than wherever each happened to be convenient.
 */

const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
const DRAWING_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml'
const CHART_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
const DRAWING_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'

/** How big a new chart is, in points: Excel's own default, near enough. */
const WIDTH = 360
const HEIGHT = 216

/**
 * The numbers under a range, as a chart reads them.
 *
 * The first column is the names along the bottom and every other column is a
 * series, which is the arrangement people have in front of them when they
 * reach for a chart. A header row names the series; without one they are
 * numbered, as Excel numbers them.
 */
export function chartDataFrom(
  open: OpenWorkbook,
  sheet: OpenSheet,
  range: GridRange,
): { data: ChartData; source: SheetSource } | null {
  const top = Math.min(range.anchor.row, range.focus.row)
  const bottom = Math.max(range.anchor.row, range.focus.row)
  const left = Math.min(range.anchor.column, range.focus.column)
  const right = Math.max(range.anchor.column, range.focus.column)

  // One column is a list of numbers with nothing to call them; one row is a
  // single point. Neither is a chart.
  if (bottom === top || right === left) return null

  const header = looksLikeHeader(open, sheet, {
    sheet: null,
    from: { row: top, column: left },
    to: { row: bottom, column: right },
  })
  const first = header ? top + 1 : top

  const at = (row: number, column: number) =>
    shownText(open, sheet.cells.rows.get(row)?.get(column) ?? null)

  const categories: string[] = []
  for (let row = first; row <= bottom; row += 1) categories.push(at(row, left))

  const series: { name: string; values: number[] }[] = []
  const references: SheetSource['series'][number][] = []

  for (let column = left + 1; column <= right; column += 1) {
    const values: number[] = []
    for (let row = first; row <= bottom; row += 1) {
      const number = Number(sheet.cells.rows.get(row)?.get(column)?.value ?? '')
      values.push(Number.isFinite(number) ? number : 0)
    }

    series.push({
      name: header ? at(top, column) : `Series ${String(series.length + 1)}`,
      values,
    })
    references.push({
      name: header ? cell(sheet, top, column) : '',
      values: span(sheet, first, bottom, column),
    })
  }

  if (series.length === 0) return null

  return {
    data: { categories, series },
    source: { categories: span(sheet, first, bottom, left), series: references },
  }
}

const quoted = (name: string): string =>
  /^[A-Za-z_][A-Za-z0-9_.]*$/u.test(name) ? name : `'${name.replace(/'/gu, "''")}'`

const cell = (sheet: OpenSheet, row: number, column: number): string =>
  `${quoted(sheet.name)}!$${formatReference({ row, column }).replace(/(\d+)$/u, '$$$1')}`

const span = (sheet: OpenSheet, top: number, bottom: number, column: number): string =>
  `${cell(sheet, top, column)}:${cell(sheet, bottom, column).split('!')[1] ?? ''}`

/**
 * A chart put on a sheet, over the cells it was made from.
 *
 * Everything is written into the package at once and the model is told, so
 * the chart is on screen before the file is saved — which is the whole
 * difference between inserting a chart and describing one.
 *
 * Null when the range is not something a chart can be made of.
 */
export function insertChart(
  open: OpenWorkbook,
  sheet: OpenSheet,
  range: GridRange,
  kind: NewChartKind,
): AnchoredDrawing | null {
  const read = chartDataFrom(open, sheet, range)
  if (read === null) return null

  const chartPath = nextPart(open, 'xl/charts/chart', '.xml')
  setPartText(open.pkg, chartPath, newChartPart(kind, read.data, read.source))
  ensureOverride(open.pkg, chartPath, CHART_TYPE)

  const drawingPath = drawingPartOf(open, sheet)
  const drawings = readSheetDrawings(getPartText(open.pkg, drawingPath) ?? '')

  const relationshipsPath = relationshipsOf(drawingPath)
  const relationships = parseRelationships(getPartText(open.pkg, relationshipsPath) ?? '')
  const link = addRelationship(
    relationships,
    CHART_RELATIONSHIP,
    relativeTo(drawingPath, chartPath),
  )
  setPartText(open.pkg, relationshipsPath, serializeRelationships(relationships))

  const drawing: SheetDrawing = {
    anchor: anchorBelow(range),
    content: { kind: 'chart', relationshipId: link.id },
    name: `Chart ${String(drawings.length + 1)}`,
    editAs: 'oneCell',
  }

  setPartText(open.pkg, drawingPath, writeSheetDrawings([...drawings, drawing]))

  const anchored: AnchoredDrawing = { drawing, path: chartPath }
  sheet.drawings.push(anchored)

  return anchored
}

/**
 * Where a new chart goes: under the range it was made from, and a little to
 * the right of its left edge.
 *
 * Anchored to one cell rather than two, so that it keeps its size when the
 * rows under it change — which is what Excel does with a chart somebody has
 * not resized.
 */
function anchorBelow(range: GridRange): SheetDrawing['anchor'] {
  const bottom = Math.max(range.anchor.row, range.focus.row)
  const left = Math.min(range.anchor.column, range.focus.column)

  return {
    kind: 'one',
    from: { column: left, columnOffset: 0, row: bottom + 1, rowOffset: 0 },
    width: WIDTH * EMU_PER_POINT,
    height: HEIGHT * EMU_PER_POINT,
  }
}

/**
 * The drawing part of a sheet, made if the sheet has none.
 *
 * A sheet that already has one keeps it: its other drawings are in there, and
 * a second part would be a second list Excel would not look at.
 */
function drawingPartOf(open: OpenWorkbook, sheet: OpenSheet): string {
  const xml = getPartText(open.pkg, sheet.path) ?? ''
  const relationshipsPath = relationshipsOf(sheet.path)
  const relationships = parseRelationships(getPartText(open.pkg, relationshipsPath) ?? '')

  const existing = drawingRelationshipId(xml)
  const found = existing === null ? undefined : relationships.get(existing)
  if (found !== undefined) return resolveTarget(found.target, partDirectory(sheet.path))

  const drawingPath = nextPart(open, 'xl/drawings/drawing', '.xml')
  setPartText(open.pkg, drawingPath, writeSheetDrawings([]))
  ensureOverride(open.pkg, drawingPath, DRAWING_TYPE)

  const link = addRelationship(
    relationships,
    DRAWING_RELATIONSHIP,
    relativeTo(sheet.path, drawingPath),
  )
  setPartText(open.pkg, relationshipsPath, serializeRelationships(relationships))
  setPartText(open.pkg, sheet.path, replaceDrawingReference(xml, link.id))

  return drawingPath
}

/** The next free `xl/charts/chart3.xml`-shaped name. */
function nextPart(open: OpenWorkbook, prefix: string, suffix: string): string {
  let at = 1
  while (open.pkg.parts.has(`${prefix}${String(at)}${suffix}`)) at += 1

  return `${prefix}${String(at)}${suffix}`
}

const relationshipsOf = (path: string): string => {
  const directory = partDirectory(path)
  return `${directory}/_rels/${path.slice(directory.length + 1)}.rels`
}

/** A path as one part names another, which is relative and full of `..`. */
function relativeTo(from: string, to: string): string {
  const here = partDirectory(from).split('/')
  const there = to.split('/')

  let same = 0
  while (same < here.length && here[same] === there[same]) same += 1

  const up = here.slice(same).map(() => '..')
  return [...up, ...there.slice(same)].join('/')
}

const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/** What a picture's bytes are, worked out from the name it came under. */
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

/**
 * A picture put on a sheet, at its own size.
 *
 * Its own size because that is what Excel does and what somebody expects: a
 * photograph dropped on a sheet arrives as a photograph rather than as a
 * square. The size is read out of the first few dozen bytes rather than by
 * decoding the image, which is a great deal of work for two numbers.
 *
 * Null for bytes nothing here can read as a picture, which is a file
 * somebody chose by mistake rather than a failure to be reported in a banner.
 */
export function insertPicture(
  open: OpenWorkbook,
  sheet: OpenSheet,
  at: { row: number; column: number },
  file: { name: string; bytes: Uint8Array },
): AnchoredDrawing | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const contentType = CONTENT_TYPES[extension]
  if (contentType === undefined) return null

  const drawingPath = drawingPartOf(open, sheet)
  const drawings = readSheetDrawings(getPartText(open.pkg, drawingPath) ?? '')

  const added = addMedia(open.pkg, {
    directory: 'xl/media',
    relsPart: relationshipsOf(drawingPath),
    relationshipType: IMAGE_RELATIONSHIP,
    fileName: file.name,
    contentType,
    bytes: file.bytes,
  })

  // Pixels at ninety-six to the inch, which is what every screen-made image
  // means by its size and what Excel assumes of one.
  const size = imageSize(file.bytes) ?? { width: 320, height: 240 }
  const emu = (pixels: number) => Math.round((pixels / 96) * 72 * EMU_PER_POINT)

  const drawing: SheetDrawing = {
    anchor: {
      kind: 'one',
      from: { column: at.column, columnOffset: 0, row: at.row, rowOffset: 0 },
      width: emu(size.width),
      height: emu(size.height),
    },
    content: { kind: 'picture', relationshipId: added.relationshipId },
    name: `Picture ${String(drawings.length + 1)}`,
    editAs: 'oneCell',
  }

  setPartText(open.pkg, drawingPath, writeSheetDrawings([...drawings, drawing]))

  const anchored: AnchoredDrawing = { drawing, path: added.path }
  sheet.drawings.push(anchored)

  return anchored
}
