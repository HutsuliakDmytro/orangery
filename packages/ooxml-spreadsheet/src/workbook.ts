import {
  attribute,
  children,
  findChild,
  getPartText,
  parseRelationships,
  parseXml,
  resolveTarget,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'

/**
 * A workbook, read far enough to find the cells.
 *
 * This is the minimum a chart needs from the spreadsheet it embeds: which
 * sheets there are, what they are called, and which part holds each one. The
 * rest of `workbook.xml` — the views, the calculation properties, the defined
 * names — is not modelled and not touched.
 *
 * It is also the first stone of the spreadsheet app, which is why the reader is
 * here rather than inside `packages/charts`: a chart in a deck embeds a
 * workbook, and a chart in a sheet points at one. Same parts, same reader.
 */

export interface SheetEntry {
  name: string
  /** The `sheetId` attribute, which is not the position and not the rel id. */
  sheetId: string | null
  /** The part that holds it, e.g. `xl/worksheets/sheet1.xml`. */
  path: string
  /**
   * `visible`, `hidden`, or `veryHidden` — which is hidden from the menu that
   * unhides things, and is how a workbook keeps a working sheet out of sight.
   */
  state: 'visible' | 'hidden' | 'veryHidden'
}

export interface DefinedName {
  name: string
  /** What it stands for: a range, usually, but any formula is allowed. */
  formula: string
  /**
   * The sheet it belongs to, by position, or null for the whole workbook.
   *
   * Two names can be spelled the same when one is local to a sheet, and then
   * the local one wins inside it — which is why this is kept rather than
   * flattened into one list.
   */
  sheet: number | null
  hidden: boolean
}

export interface Workbook {
  sheets: SheetEntry[]
  /** Dates counted from 1904 rather than 1900, as Excel for Mac once did. */
  date1904: boolean
  definedNames: DefinedName[]
  /** The sheet the workbook opens on. */
  activeSheet: number
  /**
   * `fullCalcOnLoad` — the workbook asking to be recalculated before it is
   * shown, because whoever wrote it knew its cached values were stale.
   */
  fullCalcOnLoad: boolean
}

const WORKBOOK_PART = 'xl/workbook.xml'

export function readWorkbook(pkg: OoxmlPackage): Workbook | null {
  const root = parseXml(getPartText(pkg, WORKBOOK_PART) ?? '').find(
    (node) => tagName(node) === 'workbook',
  )
  if (root === undefined) return null

  const relationships = parseRelationships(getPartText(pkg, 'xl/_rels/workbook.xml.rels') ?? '')
  const properties = findChild(root, 'workbookPr')
  const sheets = findChild(root, 'sheets')

  const views = findChild(root, 'bookViews')
  const view = views === undefined ? undefined : findChild(views, 'workbookView')
  const calculation = findChild(root, 'calcPr')
  const names = findChild(root, 'definedNames')
  const active = Number(attribute(view ?? {}, 'activeTab'))

  return {
    date1904:
      attribute(properties ?? {}, 'date1904') === '1' ||
      attribute(properties ?? {}, 'date1904') === 'true',
    activeSheet: Number.isFinite(active) ? active : 0,
    fullCalcOnLoad:
      attribute(calculation ?? {}, 'fullCalcOnLoad') === '1' ||
      attribute(calculation ?? {}, 'fullCalcOnLoad') === 'true',
    definedNames: names === undefined ? [] : readDefinedNames(names),
    sheets:
      sheets === undefined
        ? []
        : children(sheets).flatMap((sheet) => {
            const name = attribute(sheet, 'name')
            const id = attribute(sheet, 'r:id')
            const target = id === undefined ? undefined : relationships.get(id)?.target
            if (name === undefined || target === undefined) return []

            const state = attribute(sheet, 'state')

            return [
              {
                name,
                sheetId: attribute(sheet, 'sheetId') ?? null,
                path: resolveTarget(target, 'xl'),
                state: state === 'hidden' || state === 'veryHidden' ? state : ('visible' as const),
              },
            ]
          }),
  }
}

function readDefinedNames(names: XmlNode): DefinedName[] {
  return children(names).flatMap((entry) => {
    const name = attribute(entry, 'name')
    if (name === undefined) return []

    const sheet = Number(attribute(entry, 'localSheetId'))

    return [
      {
        name,
        formula: textOf(entry),
        sheet: Number.isFinite(sheet) ? sheet : null,
        hidden: attribute(entry, 'hidden') === '1',
      },
    ]
  })
}

/** The part a sheet name refers to, or null when the workbook has no such sheet. */
export function sheetPath(pkg: OoxmlPackage, name: string): string | null {
  const workbook = readWorkbook(pkg)
  if (workbook === null) return null

  // A chart's formula names the sheet, and a workbook with one sheet is the
  // ordinary case for an embedded one — so an unmatched name falls back to the
  // first sheet rather than to nothing.
  const wanted = workbook.sheets.find((sheet) => sheet.name === name)
  return wanted?.path ?? workbook.sheets[0]?.path ?? null
}

/**
 * The shared string table, as a list.
 *
 * Cells of type `s` hold an index into this rather than their own text, which
 * is how a sheet with ten thousand repeated words stays small. Rich text runs
 * inside an entry are flattened: the words are what a chart shows, and their
 * formatting belongs to the cell nobody here is styling.
 */
export function readSharedStrings(pkg: OoxmlPackage): string[] {
  const root = parseXml(getPartText(pkg, 'xl/sharedStrings.xml') ?? '').find(
    (node) => tagName(node) === 'sst',
  )
  if (root === undefined) return []

  return children(root)
    .filter((child) => tagName(child) === 'si')
    .map((entry) => textOf(entry))
}

/** Every `t` under a node, joined — an entry split across runs is one string. */
export function textOf(node: { [key: string]: unknown }): string {
  const tag = tagName(node)
  if (tag === null) return ''
  if (tag === '#text') return typeof node['#text'] === 'string' ? node['#text'] : ''

  return children(node)
    .map((child) => textOf(child))
    .join('')
}
