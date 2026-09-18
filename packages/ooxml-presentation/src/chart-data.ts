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
 * putting a new value in a cell that already exists.
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

/**
 * Writes a value into a cell that is already there.
 *
 * A number becomes a plain value; words become an inline string. The other way
 * to write words is an index into the workbook's shared table, and adding to
 * that table means keeping its counts right for a gain nobody can see — an
 * inline string is what the format offers for exactly this.
 *
 * The type attribute has to change with the value, or a workbook that held a
 * shared string reads a number as an index into the table.
 */
function setCell(sheet: XmlNode, reference: string, value: number | string): boolean {
  const data = findChild(sheet, 'sheetData')
  if (data === undefined) return false

  for (const row of children(data)) {
    for (const cell of children(row)) {
      if (attribute(cell, 'r') !== reference) continue

      const nodes = children(cell)
      nodes.length = 0

      if (typeof value === 'number') {
        nodes.push(element('v', {}, [{ '#text': String(value) }]))
        setAttribute(cell, 't', 'n')
      } else {
        nodes.push(element('is', {}, [element('t', {}, [{ '#text': value }])]))
        setAttribute(cell, 't', 'inlineStr')
      }

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
  change: ChartValues | ChartCategories,
): Promise<{ path: string; bytes: Uint8Array } | null> {
  const found = chartSpace(pkg, part)
  const series =
    found === null ? undefined : seriesNodes(found.space)['series' in change ? change.series : 0]
  const holder =
    series === undefined
      ? undefined
      : 'series' in change
        ? valuesOf(series)
        : findChild(series, 'c:cat')
  const formula = holder === undefined ? undefined : findDescendant(holder, 'c:f')
  if (formula === undefined) return null

  const range = cellsOf(textOf(formula))
  if (range === null) return null

  const wanted: readonly (number | string)[] =
    'series' in change ? change.values : change.categories

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
    const value = wanted[index]
    if (value !== undefined && setCell(sheet, reference, value)) changed = true
  }
  if (!changed) return null

  setPartText(book, sheetPath, withDeclaration(buildXml(roots)))
  return { path, bytes: await writePackage(book) }
}

export interface ChartCategories {
  /** The names along the bottom, which every series shares. */
  categories: readonly string[]
}

/**
 * Renames the categories in the cache every series carries.
 *
 * Every one of them, because a chart writes the same list into each series and
 * a chart where two series disagreed about what Q2 is called would be one
 * PowerPoint redraws from whichever it read last.
 */
export function writeChartCategories(
  pkg: OoxmlPackage,
  part: string,
  change: ChartCategories,
): boolean {
  const found = chartSpace(pkg, part)
  if (found === null) return false

  let changed = false

  for (const series of seriesNodes(found.space)) {
    const holder = findChild(series, 'c:cat')
    const cache = holder === undefined ? undefined : findDescendant(holder, 'c:strCache')
    if (cache === undefined) continue

    for (const point of children(cache)) {
      if (tagName(point) !== 'c:pt') continue

      const index = Number(attribute(point, 'idx'))
      const wanted = change.categories[index]
      const value = findChild(point, 'c:v')
      if (!Number.isFinite(index) || wanted === undefined || value === undefined) continue
      if (textOf(value) === wanted) continue

      const nodes = children(value)
      nodes.length = 0
      nodes.push({ '#text': wanted })
      changed = true
    }
  }

  if (changed) setPartText(pkg, part, withDeclaration(buildXml(found.roots)))
  return changed
}

/** `Sheet1!$B$2:$B$5` with its last row moved by `by`, or null for a single cell. */
function shifted(formula: string, by: number): string | null {
  const match = /^('?[^'!]+'?!)\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/u.exec(formula.trim())
  if (match === null) return null

  const [, sheet, fromColumn, fromRow, toColumn, toRow] = match
  if (sheet === undefined || toRow === undefined) return null

  const last = Number(toRow) + by
  // A range that would end before it starts is a chart with no points, which
  // is not a chart anybody meant to make.
  if (last < Number(fromRow)) return null

  return `${sheet}$${String(fromColumn)}$${String(fromRow)}:$${String(toColumn)}$${String(last)}`
}

/** Puts a string into an element that holds its text as a child. */
function setText(node: XmlNode, text: string): void {
  const nodes = children(node)
  nodes.length = 0
  nodes.push({ '#text': text })
}

/**
 * Adds or takes away a point, in every cache the chart carries.
 *
 * Every series and every reference: the categories, the values, and a
 * scatter's own x. They are rows of one table, and a chart where one series
 * had five points and another four is one PowerPoint draws with a gap nobody
 * put there.
 */
function editPoints(space: XmlNode, at: number, insert: boolean): boolean {
  let changed = false

  for (const series of seriesNodes(space)) {
    for (const holder of children(series)) {
      const tag = tagName(holder) ?? ''
      // `c:tx` names one cell, and a series name is not a point.
      if (!['c:cat', 'c:val', 'c:xVal', 'c:yVal'].includes(tag)) continue

      const cache = findDescendant(holder, 'c:numCache') ?? findDescendant(holder, 'c:strCache')
      const formula = findDescendant(holder, 'c:f')
      if (cache === undefined) continue

      const points = children(cache).filter((child) => tagName(child) === 'c:pt')
      const count = findChild(cache, 'c:ptCount')

      if (insert) {
        for (const point of points) {
          const index = Number(attribute(point, 'idx'))
          if (Number.isFinite(index) && index >= at) setAttribute(point, 'idx', String(index + 1))
        }

        const made = element('c:pt', { idx: String(at) }, [
          element('c:v', {}, [{ '#text': tag === 'c:cat' ? 'New' : '0' }]),
        ])
        children(cache).push(made)
      } else {
        const nodes = children(cache)
        const gone = nodes.findIndex(
          (child) => tagName(child) === 'c:pt' && Number(attribute(child, 'idx')) === at,
        )
        if (gone !== -1) nodes.splice(gone, 1)

        for (const point of nodes) {
          const index = Number(attribute(point, 'idx'))
          if (Number.isFinite(index) && index > at) setAttribute(point, 'idx', String(index - 1))
        }
      }

      if (count !== undefined) {
        const now = Number(attribute(count, 'val')) + (insert ? 1 : -1)
        setAttribute(count, 'val', String(Math.max(now, 0)))
      }

      if (formula !== undefined) {
        const moved = shifted(textOf(formula), insert ? 1 : -1)
        if (moved !== null) setText(formula, moved)
      }

      changed = true
    }
  }

  return changed
}

/**
 * Adds a point to a chart, or takes one away.
 *
 * `at` is the row, counting from zero as the caches do. The caches and the
 * ranges move together: a range that still said five rows after a point went
 * would be a chart PowerPoint rebuilds with an empty bar on the end.
 */
export function writeChartPoints(
  pkg: OoxmlPackage,
  part: string,
  change: { at: number; insert: boolean },
): boolean {
  const found = chartSpace(pkg, part)
  if (found === null || change.at < 0) return false

  if (!editPoints(found.space, change.at, change.insert)) return false

  setPartText(pkg, part, withDeclaration(buildXml(found.roots)))
  return true
}

/** The column letters and the first row of a chart's data, from its categories. */
function dataRange(space: XmlNode): { sheet: string; first: number; category: string } | null {
  const series = seriesNodes(space)[0]
  const holder = series === undefined ? undefined : findChild(series, 'c:cat')
  const formula = holder === undefined ? undefined : findDescendant(holder, 'c:f')
  if (formula === undefined) return null

  const match = /^'?([^'!]+)'?!\$([A-Z]+)\$(\d+)/u.exec(textOf(formula).trim())
  return match?.[1] === undefined || match[2] === undefined || match[3] === undefined
    ? null
    : { sheet: match[1], category: match[2], first: Number(match[3]) }
}

/** A cell reference with its row replaced. */
const movedCell = (reference: string, row: number): string =>
  reference.replace(/\d+$/u, String(row))

/**
 * The workbook with a row put in or taken out.
 *
 * Rows below are renumbered, and so is every cell in them: a sheet where two
 * rows call themselves the fourth is one Excel offers to repair.
 */
export async function patchedWorkbookRows(
  pkg: OoxmlPackage,
  part: string,
  change: { at: number; insert: boolean },
): Promise<{ path: string; bytes: Uint8Array } | null> {
  const found = chartSpace(pkg, part)
  const range = found === null ? null : dataRange(found.space)
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
  const data = sheet === undefined ? undefined : findChild(sheet, 'sheetData')
  if (data === undefined) return null

  const wanted = range.first + change.at
  const rows = children(data)
  const from = rows.findIndex((row) => Number(attribute(row, 'r')) === wanted)
  if (from === -1) return null

  if (change.insert) {
    const template = rows[from]
    if (template === undefined) return null

    // Shaped like the row it is going in front of, and empty: the columns of a
    // chart's table are the same all the way down, and a row with different
    // ones would be a row Excel reads as a different table.
    const made = element(
      'row',
      { r: String(wanted) },
      children(template).flatMap((cell) => {
        const reference = attribute(cell, 'r')
        if (reference === undefined) return []

        const column = reference.replace(/\d+$/u, '')
        return [
          column === range.category
            ? element('c', { r: reference, t: 'inlineStr' }, [
                element('is', {}, [element('t', {}, [{ '#text': 'New' }])]),
              ])
            : element('c', { r: reference, t: 'n' }, [element('v', {}, [{ '#text': '0' }])]),
        ]
      }),
    )

    rows.splice(from, 0, made)
  } else {
    rows.splice(from, 1)
  }

  // Everything from where it happened, renumbered.
  for (const row of rows) {
    const number = Number(attribute(row, 'r'))
    if (!Number.isFinite(number) || number < wanted) continue

    const now = change.insert ? number + 1 : number - 1
    const already = rows.indexOf(row) === from && change.insert
    const target = already ? wanted : now

    setAttribute(row, 'r', String(target))
    for (const cell of children(row)) {
      const reference = attribute(cell, 'r')
      if (reference !== undefined) setAttribute(cell, 'r', movedCell(reference, target))
    }
  }

  setPartText(book, sheetPath, withDeclaration(buildXml(roots)))
  return { path, bytes: await writePackage(book) }
}
