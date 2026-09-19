import {
  attribute,
  children,
  findChild,
  getPartText,
  parseXml,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { readColorChild, readFill } from '@orangery/ooxml-drawingml'
import type { Color, Fill } from '@orangery/ooxml-drawingml'
import { TABLE_STYLES_PART } from './parts'
import type { TableProperties } from '@orangery/ooxml-drawingml'

/**
 * How a table is painted, beyond what each cell says for itself.
 *
 * Here is the thing worth knowing before reading any of this: **PowerPoint's
 * built-in table styles are not in the file**. `ppt/tableStyles.xml` usually
 * holds one attribute — a GUID naming a style PowerPoint keeps inside itself —
 * and nothing else. Seventy-odd of them exist and none of them ship in the
 * deck.
 *
 * So there are two cases, and they are different in kind:
 *
 *   - the style is written out, as LibreOffice and some exporters do. Then it
 *     is read and followed, and the table looks like it should.
 *   - the style is a built-in GUID. Then there is nothing to read, and the
 *     choice is between drawing the table bare and approximating. Bare is
 *     wrong in a way that is easy to miss — a header row that should be solid
 *     accent is simply white — so a plain banded approximation is drawn
 *     instead, from the deck's own theme. It is a guess, it is labelled a
 *     guess, and it is closer than nothing.
 */

/** What a style says about one part of a table. */
export interface TablePart {
  fill: Fill | null
  bold: boolean | null
  color: Color | null
}

export interface TableStyle {
  wholeTable: TablePart | null
  firstRow: TablePart | null
  lastRow: TablePart | null
  firstColumn: TablePart | null
  /** The shaded stripe of banded rows; the other stripe is the whole-table fill. */
  bandedRow: TablePart | null
}

const EMPTY: TableStyle = {
  wholeTable: null,
  firstRow: null,
  lastRow: null,
  firstColumn: null,
  bandedRow: null,
}

function readPart(node: XmlNode | undefined): TablePart | null {
  if (node === undefined) return null

  const cell = findChild(node, 'a:tcStyle')
  const fillHolder = cell === undefined ? undefined : findChild(cell, 'a:fill')
  const fill = fillHolder === undefined ? null : fillOf(fillHolder)

  const text = findChild(node, 'a:tcTxStyle')
  const bold = text === undefined ? null : attribute(text, 'b') === 'on'
  // The colour the style states for its words, which is a header row's whole
  // point: solid accent behind white text. Left unread it falls back to the
  // theme's text colour, and a white-on-accent header comes out black.
  const solid = text === undefined ? undefined : findChild(text, 'a:solidFill')
  const color = solid === undefined ? null : readColorChild(solid)

  return { fill, bold, color }
}

function fillOf(holder: XmlNode): Fill | null {
  for (const child of children(holder)) {
    const read = readFill(child)
    if (read !== null) return read
  }
  return null
}

/** Every table style the deck actually writes out, by its id. */
export function readTableStyles(pkg: OoxmlPackage): Map<string, TableStyle> {
  const text = getPartText(pkg, TABLE_STYLES_PART)
  if (text === undefined) return new Map()

  const root = parseXml(text).find((node) => tagName(node) === 'a:tblStyleLst')
  if (root === undefined) return new Map()

  const styles = new Map<string, TableStyle>()
  for (const style of children(root)) {
    if (tagName(style) !== 'a:tblStyle') continue
    const id = attribute(style, 'styleId')
    if (id === undefined) continue

    styles.set(id, {
      wholeTable: readPart(findChild(style, 'a:wholeTbl')),
      firstRow: readPart(findChild(style, 'a:firstRow')),
      lastRow: readPart(findChild(style, 'a:lastRow')),
      firstColumn: readPart(findChild(style, 'a:firstCol')),
      bandedRow: readPart(findChild(style, 'a:band1H')),
    })
  }

  return styles
}

/**
 * A stand-in for the built-in style a deck names but does not contain.
 *
 * Modelled on "Medium Style 2", which is what PowerPoint inserts and therefore
 * what most tables in most decks are: a solid accent header with white bold
 * text, and rows banded in a wash of the same accent.
 */
export function builtInApproximation(): TableStyle {
  const accent = (alpha: number): Fill => ({
    kind: 'solid',
    color: {
      source: { kind: 'scheme', name: 'accent1' },
      transforms: alpha === 1 ? [] : [{ kind: 'alpha', value: alpha }],
    },
  })

  return {
    wholeTable: null,
    firstRow: {
      fill: accent(1),
      bold: true,
      // `lt1` rather than white: on a deck whose light colour is not white, the
      // header text is that colour, which is what "white bold text" means once
      // the theme has a say.
      color: { source: { kind: 'scheme', name: 'lt1' }, transforms: [] },
    },
    lastRow: null,
    firstColumn: null,
    bandedRow: { fill: accent(0.2), bold: null, color: null },
  }
}

/** The style to paint a table with: its own if the deck has it, else the guess. */
export function styleFor(styles: ReadonlyMap<string, TableStyle>, id: string | null): TableStyle {
  if (id === null) return EMPTY
  return styles.get(id) ?? builtInApproximation()
}

/**
 * Which part of the style applies to a cell.
 *
 * Later entries win, which is the order the specification gives: the whole
 * table first, then the banding, then the edges, so a header cell in the first
 * column is a header cell.
 */
export function partsFor(
  style: TableStyle,
  properties: TableProperties,
  at: { row: number; column: number; rows: number },
): TablePart[] {
  const parts: (TablePart | null)[] = [style.wholeTable]

  // The band counts from the first body row, so a table with a header starts
  // banding below it — otherwise the stripe under the header is the header's
  // own colour again.
  const bodyRow = at.row - (properties.firstRow ? 1 : 0)
  if (properties.bandedRows && bodyRow >= 0 && bodyRow % 2 === 1) parts.push(style.bandedRow)

  if (properties.firstColumn && at.column === 0) parts.push(style.firstColumn)
  if (properties.lastRow && at.row === at.rows - 1) parts.push(style.lastRow)
  if (properties.firstRow && at.row === 0) parts.push(style.firstRow)

  return parts.filter((part): part is TablePart => part !== null)
}
