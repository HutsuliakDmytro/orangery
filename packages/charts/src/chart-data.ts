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
  partDirectory,
  withDeclaration,
  writePackage,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import {
  cellsOfRange,
  clearCell,
  extendedRange,
  insertRow,
  openSheet,
  parseRange,
  removeRow,
  saveSheet,
  sheetPath,
  writeCell,
} from '@orangery/ooxml-spreadsheet'

/**
 * Changing the numbers a chart draws.
 *
 * A chart says the same thing twice. The `c:numCache` beside each series is
 * what gets drawn — by PowerPoint and Excel as much as by this app — and the
 * workbook embedded in the package is what "Edit Data" opens. Writing one
 * without the other is the trap: Office rebuilds the cache from the workbook
 * the moment anybody opens the data, so a chart edited only in its cache is a
 * chart whose edit disappears the first time somebody looks at it.
 *
 * So both are written. The cache is a patch on the chart part; the workbook is
 * a zip inside the zip, opened, patched cell by cell and written back.
 *
 * Nothing here knows which kind of package it is in. A chart part sits at
 * `ppt/charts/chart1.xml` in a deck and `word/charts/chart1.xml` in a
 * document, and the workbook beside it is found through the part's own
 * relationships either way. A chart in a sheet is the exception and does not
 * come through here at all: it is drawn from the cells of the workbook it
 * lives in, and there is no second copy of the numbers to keep in step.
 *
 * What is not done here is changing how many points there are. That moves the
 * range in `c:f`, which moves the cells, which is a different operation from
 * putting a new value in a cell that already exists.
 */

/** The `_rels` part that belongs to a part — `a/b.xml` keeps its rels in `a/_rels/b.xml.rels`. */
function relsPartFor(path: string): string {
  const directory = partDirectory(path)
  const name = path.slice(directory.length + 1)
  return `${directory}/_rels/${name}.rels`
}

export interface ChartValues {
  /** Which series, counting through the plot area in the order it lists them. */
  series: number
  /**
   * One per point. Null is a gap — a point the chart has no number for — and
   * is not the same as nought: a nought is a bar of no height, and a gap is no
   * bar at all.
   */
  values: readonly (number | null)[]
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

/** Where a change wants to write: the numbers, the x, the names, or the title. */
function holderFor(
  series: XmlNode,
  change: ChartValues | ChartCategories | ChartSeriesName | ChartXValues,
): XmlNode | undefined {
  if ('values' in change) return valuesOf(series)
  if ('xValues' in change) return findChild(series, 'c:xVal')
  if ('name' in change) return findChild(series, 'c:tx')
  return findChild(series, 'c:cat')
}

/** The `c:val` of a series, which a scatter calls `c:yVal`. */
const valuesOf = (series: XmlNode): XmlNode | undefined =>
  findChild(series, 'c:val') ?? findChild(series, 'c:yVal')

const textOf = (node: XmlNode): string =>
  children(node)
    .map((child) => textValue(child))
    .join('')

/** Reads a chart from its XML, or null where the text is not a chart. */
function chartSpaceIn(xml: string) {
  const roots = parseXml(xml)
  const space = roots.find((node) => tagName(node) === 'c:chartSpace')
  return space === undefined ? null : { roots, space }
}

/** Reads the chart part, or null where the part is not a chart. */
function chartSpace(pkg: OoxmlPackage, part: string) {
  return chartSpaceIn(getPartText(pkg, part) ?? '')
}

/**
 * Applies a change to a chart's XML, returning the new text or null.
 *
 * The form the document app needs: there the chart part lives in the node that
 * draws it, so that the undo history owns it, and the package is written from
 * the node at save. The deck app's package-level writers below are this with
 * the reading and writing of the part around them.
 */
function editing(xml: string, change: (space: XmlNode) => boolean): string | null {
  const found = chartSpaceIn(xml)
  if (found === null) return null

  return change(found.space) ? withDeclaration(buildXml(found.roots)) : null
}

/**
 * Puts new numbers into the cache the chart is drawn from.
 *
 * Only as many as the series already has: a chart with five points and four
 * numbers would be a chart missing a bar, and adding one is the other
 * operation.
 */
export function writeChartCache(pkg: OoxmlPackage, part: string, change: ChartValues): boolean {
  const written = writeValuesIn(getPartText(pkg, part) ?? '', change)
  if (written === null) return false

  setPartText(pkg, part, written)
  return true
}

/** The same edit against the chart's XML, for a caller that holds the text. */
export const writeValuesIn = (xml: string, change: ChartValues): string | null =>
  editing(xml, (space) => changeValues(space, change))

function changeValues(space: XmlNode, change: ChartValues): boolean {
  const series = seriesNodes(space)[change.series]
  const holder = series === undefined ? undefined : valuesOf(series)
  const cache = holder === undefined ? undefined : findDescendant(holder, 'c:numCache')

  return cache === undefined ? false : writePoints(cache, change.values)
}

/**
 * Puts numbers into a cache, one per point, leaving the gaps as gaps.
 *
 * Shared by the values and a scatter's x, which are the same thing written
 * against different elements.
 */
function writePoints(cache: XmlNode, values: readonly (number | null)[]): boolean {
  let changed = false
  const points = children(cache)

  // Backwards, because emptying a point removes it and a forward walk would
  // then step over its neighbour.
  for (let at = points.length - 1; at >= 0; at -= 1) {
    const point = points[at]
    if (point === undefined || tagName(point) !== 'c:pt') continue

    const index = Number(attribute(point, 'idx'))
    const wanted = values[index]
    if (!Number.isFinite(index) || wanted === undefined) continue

    // A gap is written the way a cache writes one: the point is not there.
    // `c:ptCount` stays as it is, because the chart still has that many
    // points — one of them simply has no number.
    if (wanted === null) {
      points.splice(at, 1)
      changed = true
      continue
    }

    const value = findChild(point, 'c:v')
    if (value === undefined) continue

    const written = String(wanted)
    if (textOf(value) === written) continue

    const nodes = children(value)
    nodes.length = 0
    nodes.push({ '#text': written })
    changed = true
  }

  return changed
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
  change: ChartValues | ChartCategories | ChartSeriesName | ChartXValues,
): Promise<{ path: string; bytes: Uint8Array } | null> {
  const space = chartSpace(pkg, part)
  const series =
    space === null ? undefined : seriesNodes(space.space)['series' in change ? change.series : 0]

  // Which cells the change is about: the series' numbers, where they sit along
  // the bottom, the names every series shares, or the one cell the series
  // takes its own name from.
  const holder = series === undefined ? undefined : holderFor(series, change)
  const formula = holder === undefined ? undefined : findDescendant(holder, 'c:f')
  if (formula === undefined) return null

  const range = parseRange(textOf(formula))
  if (range === null) return null

  const wanted: readonly (number | string | null)[] =
    'values' in change
      ? change.values
      : 'xValues' in change
        ? change.xValues
        : 'name' in change
          ? [change.name]
          : change.categories

  const book = await openEmbedded(pkg, part, range.sheet ?? '')
  if (book === null) return null

  const written = cellsOfRange(range).filter((reference: string, index: number) => {
    const value = wanted[index]
    if (value === undefined) return false

    // Both halves say the same thing about a gap: the cache has no point and
    // the workbook has no cell. Writing a nought into one of them would have
    // Office rebuild the other with a bar nobody put there.
    return value === null
      ? clearCell(book.sheet, reference)
      : writeCell(book.sheet, reference, value)
  })
  if (written.length === 0) return null

  saveSheet(book.package, book.sheet)
  return { path: book.path, bytes: await writePackage(book.package) }
}

/**
 * The workbook a chart part points at, opened, with the sheet a range names.
 *
 * The workbook is a zip inside the zip, which is why this is asynchronous. The
 * relationship is read from the chart part's own rels, so the same code finds
 * it in a deck at `ppt/charts/` and in a document at `word/charts/`.
 */
async function openEmbedded(pkg: OoxmlPackage, part: string, sheetName: string) {
  const relationships = parseRelationships(getPartText(pkg, relsPartFor(part)) ?? '')
  const embedded = [...relationships.values()].find((one) => one.type.endsWith('/package'))
  if (embedded === undefined) return null

  const path = resolveTarget(embedded.target, partDirectory(part))
  const bytes = pkg.parts.get(path)?.bytes
  if (bytes === undefined) return null

  const embeddedPackage = await readPackage(bytes)
  const worksheet = sheetPath(embeddedPackage, sheetName)
  const sheet = worksheet === null ? null : openSheet(embeddedPackage, worksheet)

  return sheet === null ? null : { package: embeddedPackage, sheet, path }
}

export interface ChartCategories {
  /** The names along the bottom, which every series shares. */
  categories: readonly string[]
}

export interface ChartXValues {
  series: number
  /**
   * Where each point sits along the bottom.
   *
   * A scatter's own question: everything else steps its points evenly and
   * names them, and a scatter measures them. Same shape of change as the
   * values, in the cache beside `c:xVal` and in the column of the workbook it
   * points at.
   */
  xValues: readonly (number | null)[]
}

export interface ChartSeriesName {
  series: number
  /** What the series is called — in the legend, and in the cell it came from. */
  name: string
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
  const written = writeCategoriesIn(getPartText(pkg, part) ?? '', change)
  if (written === null) return false

  setPartText(pkg, part, written)
  return true
}

/** The same edit against the chart's XML, for a caller that holds the text. */
export const writeCategoriesIn = (xml: string, change: ChartCategories): string | null =>
  editing(xml, (space) => changeCategories(space, change))

function changeCategories(space: XmlNode, change: ChartCategories): boolean {
  let changed = false

  for (const series of seriesNodes(space)) {
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

  return changed
}

/**
 * Renames a series in the cache the legend is drawn from.
 *
 * The name is a cache like any other — one point long, beside a reference to
 * the cell it came from — so it is patched the same way, and the cell is
 * brought into step by `patchedWorkbook`.
 */
export function writeChartSeriesName(
  pkg: OoxmlPackage,
  part: string,
  change: ChartSeriesName,
): boolean {
  const written = writeSeriesNameIn(getPartText(pkg, part) ?? '', change)
  if (written === null) return false

  setPartText(pkg, part, written)
  return true
}

/**
 * Moves the points of a scatter along the bottom.
 *
 * Written into every series that measures itself against the same cells: a
 * scatter states its x per series, and two series reading one column have to
 * agree about what it says, or the chart draws the same range twice over.
 */
export function writeChartXValues(pkg: OoxmlPackage, part: string, change: ChartXValues): boolean {
  const written = writeXValuesIn(getPartText(pkg, part) ?? '', change)
  if (written === null) return false

  setPartText(pkg, part, written)
  return true
}

/** The same edit against the chart's XML, for a caller that holds the text. */
export const writeXValuesIn = (xml: string, change: ChartXValues): string | null =>
  editing(xml, (space) => changeXValues(space, change))

function changeXValues(space: XmlNode, change: ChartXValues): boolean {
  const all = seriesNodes(space)
  const target = all[change.series]
  if (target === undefined) return false

  const reference = (series: XmlNode): string => {
    const formula = findDescendant(findChild(series, 'c:xVal') ?? {}, 'c:f')
    return formula === undefined ? '' : textOf(formula)
  }

  const shared = reference(target)
  const sharing = all.filter(
    (series, index) => index === change.series || (shared !== '' && reference(series) === shared),
  )

  return sharing
    .map((series) => {
      const cache = findDescendant(findChild(series, 'c:xVal') ?? {}, 'c:numCache')
      return cache === undefined ? false : writePoints(cache, change.xValues)
    })
    .reduce<boolean>((any, one) => any || one, false)
}

/** The same edit against the chart's XML, for a caller that holds the text. */
export const writeSeriesNameIn = (xml: string, change: ChartSeriesName): string | null =>
  editing(xml, (space) => changeSeriesName(space, change))

function changeSeriesName(space: XmlNode, change: ChartSeriesName): boolean {
  const series = seriesNodes(space)[change.series]
  const name = series === undefined ? undefined : findChild(series, 'c:tx')
  const cache = name === undefined ? undefined : findDescendant(name, 'c:strCache')
  const point = cache === undefined ? undefined : findChild(cache, 'c:pt')
  const value = point === undefined ? undefined : findChild(point, 'c:v')

  // A series that names itself nowhere is one the legend calls "Series 1";
  // giving it a name means giving it a cell to keep it in, which is a change
  // to the workbook's shape rather than to its contents.
  if (value === undefined || textOf(value) === change.name) return false

  setText(value, change.name)
  return true
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
        const moved = extendedRange(textOf(formula), insert ? 1 : -1)
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
  const written = writePointsIn(getPartText(pkg, part) ?? '', change)
  if (written === null) return false

  setPartText(pkg, part, written)
  return true
}

/** The same edit against the chart's XML, for a caller that holds the text. */
export const writePointsIn = (
  xml: string,
  change: { at: number; insert: boolean },
): string | null =>
  change.at < 0 ? null : editing(xml, (space) => editPoints(space, change.at, change.insert))

/** Where a chart's data starts — the sheet, the categories' column, the first row. */
function dataRange(space: XmlNode): { sheet: string; first: number; category: number } | null {
  const series = seriesNodes(space)[0]
  const holder = series === undefined ? undefined : findChild(series, 'c:cat')
  const formula = holder === undefined ? undefined : findDescendant(holder, 'c:f')
  if (formula === undefined) return null

  const range = parseRange(textOf(formula))
  return range === null
    ? null
    : { sheet: range.sheet ?? '', category: range.from.column, first: range.from.row }
}

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
  const space = chartSpace(pkg, part)
  const range = space === null ? null : dataRange(space.space)
  if (range === null) return null

  const book = await openEmbedded(pkg, part, range.sheet)
  if (book === null) return null

  // The row of the sheet the point sits in: the data starts below the header,
  // and `at` counts points, as the caches do.
  const row = range.first + change.at

  // A new row is shaped like the one it goes in front of, with a name in the
  // column the categories are in and a nought everywhere else.
  const changed = change.insert
    ? insertRow(book.sheet, row, (column: number) => (column === range.category ? 'New' : 0))
    : removeRow(book.sheet, row)
  if (!changed) return null

  saveSheet(book.package, book.sheet)
  return { path: book.path, bytes: await writePackage(book.package) }
}
