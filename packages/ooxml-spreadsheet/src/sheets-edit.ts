import {
  addRelationship,
  ensureOverride,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { workbookPart } from './parts'

/**
 * Adding, removing and rearranging the sheets of a workbook.
 *
 * A sheet is three things in three places: an entry in `<sheets>` inside
 * `workbook.xml`, a relationship pointing at a part, and the part itself —
 * and, for the package to be one Excel will open, an override in
 * `[Content_Types].xml` saying what that part is. Every operation here keeps
 * all four in step, because a file with three of them is a file Excel offers
 * to repair.
 *
 * The workbook part is patched as text, like everything else this app edits
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`): a workbook carries views,
 * calculation properties and defined names that nothing here models, and a
 * regenerated one would lose them.
 */

const WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels'
const WORKSHEET_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'
const WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const escaped = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (one) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[one] ?? ''};`,
  )

/** Every `<sheet>` element of the workbook, in the order it keeps them. */
function entriesOf(xml: string): { text: string; at: number }[] {
  const found: { text: string; at: number }[] = []
  const pattern = /<sheet\s[^>]*\/>|<sheet\s[^>]*>[\s\S]*?<\/sheet>/gu

  for (const match of xml.matchAll(pattern)) {
    found.push({ text: match[0], at: match.index })
  }

  return found
}

/** The `<sheets>` list rewritten, with everything around it left alone. */
function withEntries(xml: string, entries: readonly string[]): string {
  const list = /<sheets(?:\s[^>]*)?>[\s\S]*?<\/sheets>|<sheets(?:\s[^>]*)?\/>/u.exec(xml)
  if (list === null) return xml

  const written = `<sheets>${entries.join('')}</sheets>`
  return xml.slice(0, list.index) + written + xml.slice(list.index + list[0].length)
}

/**
 * A name no other sheet is using.
 *
 * Excel refuses two sheets of one name, and a file with two is one it offers
 * to repair — so a duplicate gets a number rather than an error, which is
 * what every spreadsheet does with "Sheet1 (2)".
 */
export function freeName(taken: readonly string[], wanted: string): string {
  const used = new Set(taken.map((one) => one.toLocaleUpperCase()))
  if (!used.has(wanted.toLocaleUpperCase())) return wanted

  for (let number = 2; ; number += 1) {
    const tried = `${wanted} (${String(number)})`
    if (!used.has(tried.toLocaleUpperCase())) return tried
  }
}

/** A part name nothing in the package is using. */
function freePart(pkg: OoxmlPackage): string {
  for (let number = 1; ; number += 1) {
    const path = `xl/worksheets/sheet${String(number)}.xml`
    if (!pkg.parts.has(path)) return path
  }
}

const EMPTY_SHEET =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">` +
  '<dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
  '<sheetFormatPr defaultRowHeight="15"/><sheetData/></worksheet>'

/**
 * A sheet added to the workbook, and where it went.
 *
 * `at` is the position among the sheets; past the end, or left out, puts it
 * last. The part is new and empty, or a copy of another sheet's bytes, which
 * is the whole of what duplicating one is: the same worksheet under a
 * different name.
 */
export function addSheet(
  pkg: OoxmlPackage,
  name: string,
  options: { at?: number; copyOf?: string } = {},
): { path: string; name: string; at: number } | null {
  const xml = getPartText(pkg, workbookPart(pkg))
  if (xml === undefined) return null

  const entries = entriesOf(xml)
  const taken = entries.flatMap((entry) => {
    const stated = /\sname="([^"]*)"/u.exec(entry.text)?.[1]
    return stated === undefined ? [] : [unescaped(stated)]
  })

  const called = freeName(taken, name)
  const path = freePart(pkg)

  const relationships = parseRelationships(getPartText(pkg, WORKBOOK_RELS) ?? '')
  const relationship = addRelationship(
    relationships,
    WORKSHEET_RELATIONSHIP,
    path.replace(/^xl\//u, ''),
  )
  setPartText(pkg, WORKBOOK_RELS, serializeRelationships(relationships))

  const ids = entries.map((entry) => Number(/\ssheetId="(\d+)"/u.exec(entry.text)?.[1] ?? 0))
  const sheetId = Math.max(0, ...ids) + 1

  const written =
    `<sheet name="${escaped(called)}" sheetId="${String(sheetId)}" ` + `r:id="${relationship.id}"/>`

  const at = Math.min(Math.max(options.at ?? entries.length, 0), entries.length)
  const list = entries.map((entry) => entry.text)
  list.splice(at, 0, written)

  setPartText(pkg, workbookPart(pkg), withEntries(xml, list))

  // A copy carries the other sheet's bytes, which is what makes a duplicate a
  // duplicate: its formats, its widths, its conditional rules, all of it.
  const source = options.copyOf === undefined ? undefined : getPartText(pkg, options.copyOf)
  setPartText(pkg, path, source === undefined ? EMPTY_SHEET : alone(source))
  ensureOverride(pkg, path, WORKSHEET_TYPE)

  return { path, name: called, at }
}

/**
 * A copied worksheet with everything that points elsewhere taken out.
 *
 * A duplicate copies one part. The drawing beside it, the comments, the
 * tables and the hyperlink targets are other parts with relationships of
 * their own, and a worksheet naming a relationship that does not exist is a
 * file Excel calls damaged. So a duplicate keeps everything a sheet holds by
 * itself — the values, the formats, the widths, the merges, the conditional
 * rules — and loses what it only points at.
 */
function alone(xml: string): string {
  const elements = [
    'drawing',
    'legacyDrawing',
    'legacyDrawingHF',
    'picture',
    'oleObjects',
    'controls',
    'tableParts',
    'hyperlinks',
    'extLst',
  ]

  return elements.reduce(
    (text, name) =>
      text.replace(new RegExp(`<${name}(?:\\s[^>]*)?(?:\\/>|>[\\s\\S]*?<\\/${name}>)`, 'gu'), ''),
    xml,
  )
}

const unescaped = (text: string): string =>
  text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')

/**
 * A sheet taken out of the workbook.
 *
 * The entry and the relationship go; the part is left where it is. An orphan
 * part costs a few bytes and Excel ignores it, where a cascade of deletions
 * would have to know which drawings, comments and tables belonged to the
 * sheet — and taking away one it did not know about is how a file stops
 * opening.
 */
export function removeSheet(pkg: OoxmlPackage, at: number): boolean {
  const xml = getPartText(pkg, workbookPart(pkg))
  if (xml === undefined) return false

  const entries = entriesOf(xml)
  const going = entries[at]
  // The last sheet cannot go: a workbook with no sheets is not a workbook.
  if (going === undefined || entries.length < 2) return false

  const id = /\sr:id="([^"]*)"/u.exec(going.text)?.[1]
  if (id !== undefined) {
    const relationships = parseRelationships(getPartText(pkg, WORKBOOK_RELS) ?? '')
    relationships.delete(id)
    setPartText(pkg, WORKBOOK_RELS, serializeRelationships(relationships))
  }

  setPartText(
    pkg,
    workbookPart(pkg),
    withEntries(
      xml,
      entries.filter((_, index) => index !== at).map((entry) => entry.text),
    ),
  )

  return true
}

/** A sheet renamed, leaving everything else about it as it was. */
export function renameSheet(pkg: OoxmlPackage, at: number, name: string): string | null {
  const xml = getPartText(pkg, workbookPart(pkg))
  if (xml === undefined) return null

  const entries = entriesOf(xml)
  const entry = entries[at]
  if (entry === undefined) return null

  const taken = entries.flatMap((one, index) => {
    if (index === at) return []
    const stated = /\sname="([^"]*)"/u.exec(one.text)?.[1]
    return stated === undefined ? [] : [unescaped(stated)]
  })

  const called = freeName(taken, name)
  const written = entry.text.replace(/\sname="[^"]*"/u, ` name="${escaped(called)}"`)

  setPartText(
    pkg,
    workbookPart(pkg),
    withEntries(
      xml,
      entries.map((one, index) => (index === at ? written : one.text)),
    ),
  )

  return called
}

/** A sheet moved to another position among its neighbours. */
export function moveSheet(pkg: OoxmlPackage, from: number, to: number): boolean {
  const xml = getPartText(pkg, workbookPart(pkg))
  if (xml === undefined) return false

  const entries = entriesOf(xml).map((entry) => entry.text)
  const moving = entries[from]
  if (moving === undefined || to < 0 || to >= entries.length || from === to) return false

  entries.splice(from, 1)
  entries.splice(to, 0, moving)

  setPartText(pkg, workbookPart(pkg), withEntries(xml, entries))
  return true
}

/**
 * A sheet hidden, or brought back.
 *
 * `veryHidden` is Excel's way of keeping a working sheet out of the menu that
 * unhides things; it is read and written, and this app never sets it.
 */
export function setSheetState(
  pkg: OoxmlPackage,
  at: number,
  state: 'visible' | 'hidden' | 'veryHidden',
): boolean {
  const xml = getPartText(pkg, workbookPart(pkg))
  if (xml === undefined) return false

  const entries = entriesOf(xml)
  const entry = entries[at]
  if (entry === undefined) return false

  const without = entry.text.replace(/\sstate="[^"]*"/u, '')
  const written =
    state === 'visible' ? without : without.replace(/(<sheet\b)/u, `$1 state="${state}"`)

  setPartText(
    pkg,
    workbookPart(pkg),
    withEntries(
      xml,
      entries.map((one, index) => (index === at ? written : one.text)),
    ),
  )

  return true
}

/**
 * The colour of a sheet's tab, which lives in the worksheet rather than in the
 * workbook.
 *
 * `<sheetPr>` has to be the first child of `<worksheet>`, so a part without
 * one gets it put there rather than appended: an element in the wrong place is
 * a file Excel offers to repair.
 */
export function setTabColor(pkg: OoxmlPackage, path: string, color: string | null): boolean {
  const xml = getPartText(pkg, path)
  if (xml === undefined) return false

  const properties = /<sheetPr(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/sheetPr>)/u.exec(xml)
  const written = color === null ? '' : `<sheetPr><tabColor rgb="${escaped(color)}"/></sheetPr>`

  if (properties !== null) {
    // Only the colour changes: everything else `<sheetPr>` holds — the outline
    // properties, the code name a macro refers to — stays as it was.
    const kept =
      color === null ? withoutTabColor(properties[0]) : withTabColor(properties[0], escaped(color))

    return put(pkg, path, xml, properties.index, properties[0].length, kept)
  }

  if (written === '') return true

  const opening = /<worksheet(?:\s[^>]*)?>/u.exec(xml)
  if (opening === null) return false

  const at = opening.index + opening[0].length
  return put(pkg, path, xml, at, 0, written)
}

function put(
  pkg: OoxmlPackage,
  path: string,
  xml: string,
  at: number,
  length: number,
  written: string,
): boolean {
  setPartText(pkg, path, xml.slice(0, at) + written + xml.slice(at + length))
  return true
}

const withoutTabColor = (properties: string): string => {
  const stripped = properties.replace(/<tabColor(?:\s[^>]*)?\/>/u, '')
  // A `<sheetPr>` holding nothing but the colour goes with it.
  return /^<sheetPr(?:\s[^>]*)?><\/sheetPr>$/u.test(stripped) ? '' : stripped
}

function withTabColor(properties: string, color: string): string {
  const written = `<tabColor rgb="${color}"/>`

  if (/<tabColor(?:\s[^>]*)?\/>/u.test(properties)) {
    return properties.replace(/<tabColor(?:\s[^>]*)?\/>/u, written)
  }

  // Empty, so it has to be opened up to hold anything.
  if (properties.endsWith('/>')) {
    return `${properties.slice(0, -2)}>${written}</sheetPr>`
  }

  // First inside `<sheetPr>`, before the outline and page-setup properties:
  // that is the order the schema states, and an element out of order is a
  // file Excel offers to repair.
  return properties.replace(/^(<sheetPr(?:\s[^>]*)?>)/u, `$1${written}`)
}
