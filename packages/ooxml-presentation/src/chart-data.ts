import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  findDescendant,
  getPartText,
  parseRelationships,
  parseXml,
  readPackage,
  resolveTarget,
  setAttribute,
  setPartText,
  tagName,
  textValue,
  withDeclaration,
  writePackage,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { relsPartFor } from './insert-picture'

/**
 * Changing the numbers a chart draws.
 *
 * A chart says the same thing twice. The `c:numCache` beside each series is
 * what gets drawn — by PowerPoint as much as by this app — and the workbook
 * embedded in the package is what "Edit Data" opens. Writing one without the
 * other is the trap: PowerPoint rebuilds the cache from the workbook the moment
 * anybody opens the data, so a chart edited only in its cache is a chart whose
 * edit disappears the first time somebody looks at it.
 *
 * So both are written. The cache is a patch on the chart part; the workbook is
 * a zip inside the zip, opened, patched cell by cell and written back.
 *
 * What is not done here is changing how many points there are. That moves the
 * range in `c:f`, which moves the cells, which is a different operation from
 * putting a new number in a cell that already exists.
 */

export interface ChartValues {
  /** Which series, counting through the plot area in the order it lists them. */
  series: number
  values: readonly number[]
}

/** Every `c:ser` in the plot area, in the order a reader lists them. */
function seriesNodes(space: XmlNode): XmlNode[] {
  const chart = findChild(space, 'c:chart')
  const plot = chart === undefined ? undefined : findChild(chart, 'c:plotArea')
  if (plot === undefined) return []

  return children(plot).flatMap((group) =>
    (tagName(group) ?? '').endsWith('Chart')
      ? children(group).filter((child) => tagName(child) === 'c:ser')
      : [],
  )
}

/** The `c:val` of a series, which a scatter calls `c:yVal`. */
const valuesOf = (series: XmlNode): XmlNode | undefined =>
  findChild(series, 'c:val') ?? findChild(series, 'c:yVal')

const textOf = (node: XmlNode): string =>
  children(node)
    .map((child) => textValue(child))
    .join('')

/** Reads the chart part, or null where the part is not a chart. */
function chartSpace(pkg: OoxmlPackage, part: string) {
  const roots = parseXml(getPartText(pkg, part) ?? '')
  const space = roots.find((node) => tagName(node) === 'c:chartSpace')
  return space === undefined ? null : { roots, space }
}

/**
 * Puts new numbers into the cache the chart is drawn from.
 *
 * Only as many as the series already has: a chart with five points and four
 * numbers would be a chart missing a bar, and adding one is the other
 * operation.
 */
export function writeChartCache(pkg: OoxmlPackage, part: string, change: ChartValues): boolean {
  const found = chartSpace(pkg, part)
  if (found === null) return false

  const series = seriesNodes(found.space)[change.series]
  const holder = series === undefined ? undefined : valuesOf(series)
  const cache = holder === undefined ? undefined : findDescendant(holder, 'c:numCache')
  if (cache === undefined) return false

  let changed = false
  for (const point of children(cache)) {
    if (tagName(point) !== 'c:pt') continue

    const index = Number(attribute(point, 'idx'))
    const wanted = change.values[index]
    if (!Number.isFinite(index) || wanted === undefined) continue

    const value = findChild(point, 'c:v')
    if (value === undefined) continue

    const written = String(wanted)
    if (textOf(value) === written) continue

    const nodes = children(value)
    nodes.length = 0
    nodes.push({ '#text': written })
    changed = true
  }

  if (changed) setPartText(pkg, part, withDeclaration(buildXml(found.roots)))
  return changed
}

/** `Sheet1!$B$2:$B$5` as the sheet and the cells it names. */
export function cellsOf(formula: string): { sheet: string; cells: string[] } | null {
  const match = /^'?([^'!]+)'?!\$([A-Z]+)\$(\d+)(?::\$([A-Z]+)\$(\d+))?$/u.exec(formula.trim())
  if (match === null) return null

  const [, sheet, fromColumn, fromRow, toColumn, toRow] = match
  if (sheet === undefined || fromColumn === undefined || fromRow === undefined) return null

  // A single cell is a range of one, which is how a series name is written.
  if (toColumn === undefined || toRow === undefined) {
    return { sheet, cells: [`${fromColumn}${fromRow}`] }
  }

  // Down a column or along a row; a chart's own ranges are never a block.
  if (fromColumn === toColumn) {
    const cells: string[] = []
    for (let row = Number(fromRow); row <= Number(toRow); row += 1) {
      cells.push(`${fromColumn}${String(row)}`)
    }
    return { sheet, cells }
  }

  return { sheet, cells: [`${fromColumn}${fromRow}`] }
}

/** The worksheet part a sheet name refers to, inside the embedded workbook. */
function sheetPart(book: OoxmlPackage, name: string): string | null {
  const workbook = parseXml(getPartText(book, 'xl/workbook.xml') ?? '').find(
    (node) => tagName(node) === 'workbook',
  )
  const sheets = workbook === undefined ? undefined : findChild(workbook, 'sheets')
  if (sheets === undefined) return null

  const sheet = children(sheets).find((child) => attribute(child, 'name') === name)
  const id = sheet === undefined ? undefined : attribute(sheet, 'r:id')
  if (id === undefined) return null

  const relationships = parseRelationships(getPartText(book, 'xl/_rels/workbook.xml.rels') ?? '')
  const target = relationships.get(id)?.target
  return target === undefined ? null : resolveTarget(target, 'xl')
}

/** Writes a number into a cell that is already there. */
function setCell(sheet: XmlNode, reference: string, value: number): boolean {
  const data = findChild(sheet, 'sheetData')
  if (data === undefined) return false

  for (const row of children(data)) {
    for (const cell of children(row)) {
      if (attribute(cell, 'r') !== reference) continue

      // A cell that held a string holds a number now, and the type attribute
      // has to stop saying otherwise or the workbook reads it as an index.
      const nodes = children(cell)
      nodes.length = 0
      nodes.push(element('v', {}, [{ '#text': String(value) }]))
      setAttribute(cell, 't', 'n')
      return true
    }
  }

  return false
}

/**
 * The embedded workbook with the new numbers in it, ready to be put back.
 *
 * Asynchronous because the workbook is a zip: it has to be opened and written
 * again. Null where the chart has no workbook, or where the range it names is
 * not one this understands — the cache is still worth writing in that case, and
 * the caller is told so by getting nothing rather than an error.
 */
export async function patchedWorkbook(
  pkg: OoxmlPackage,
  part: string,
  change: ChartValues,
): Promise<{ path: string; bytes: Uint8Array } | null> {
  const found = chartSpace(pkg, part)
  const series = found === null ? undefined : seriesNodes(found.space)[change.series]
  const holder = series === undefined ? undefined : valuesOf(series)
  const formula = holder === undefined ? undefined : findDescendant(holder, 'c:f')
  if (formula === undefined) return null

  const range = cellsOf(textOf(formula))
  if (range === null) return null

  const relationships = parseRelationships(getPartText(pkg, relsPartFor(part)) ?? '')
  const embedded = [...relationships.values()].find((one) => one.type.endsWith('/package'))
  if (embedded === undefined) return null

  const path = resolveTarget(embedded.target, 'ppt/charts')
  const bytes = pkg.parts.get(path)?.bytes
  if (bytes === undefined) return null

  const book = await readPackage(bytes)
  const sheetPath = sheetPart(book, range.sheet)
  if (sheetPath === null) return null

  const roots = parseXml(getPartText(book, sheetPath) ?? '')
  const sheet = roots.find((node) => tagName(node) === 'worksheet')
  if (sheet === undefined) return null

  let changed = false
  for (const [index, reference] of range.cells.entries()) {
    const value = change.values[index]
    if (value !== undefined && setCell(sheet, reference, value)) changed = true
  }
  if (!changed) return null

  setPartText(book, sheetPath, withDeclaration(buildXml(roots)))
  return { path, bytes: await writePackage(book) }
}
