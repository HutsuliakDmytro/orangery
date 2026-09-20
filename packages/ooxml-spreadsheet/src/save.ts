import {
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { replaceSheetData } from './sheet-data'
import { replaceColumns } from './columns'
import { replaceMerges } from './merges'
import { replaceAutoFilter } from './autofilter'
import type { AutoFilter } from './autofilter'
import { replaceHyperlinks, writeHyperlinks } from './hyperlinks'
import { replaceValidations, writeValidations } from './validation'
import type { DataValidation } from './validation'
import type { Hyperlink } from './hyperlinks'
import type { SheetCells } from './cells'
import type { CellRange } from './reference'
import type { ColumnRange } from './worksheet'

/**
 * A workbook, written back.
 *
 * Three tiers, as the ADR sets them out
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`). The cells are modelled and
 * regenerated. The rest of a worksheet is patched in place, which here means
 * `sheetData` is cut out of the original text and a new one put in its
 * place — so every element nothing here understands keeps its own bytes, in
 * its own order, with its own namespace prefixes. And the parts that are
 * somebody else's program — a pivot cache, a macro, a query — are never
 * opened at all.
 *
 * What that buys is the only claim worth making about a save: the diff of a
 * file somebody opened and saved without touching is empty.
 */

export interface SheetToWrite {
  /** The part, e.g. `xl/worksheets/sheet1.xml`. */
  path: string
  cells: SheetCells
  /**
   * The column runs, where they may have changed.
   *
   * Left out for a sheet nobody has resized, so that its `<cols>` keeps its
   * own bytes rather than being rewritten into the same thing.
   */
  columns?: readonly ColumnRange[]
  /** The merged ranges, where they may have changed; left out for none. */
  merges?: readonly CellRange[]
  /** The autofilter, likewise; null takes it away, undefined leaves it. */
  filter?: AutoFilter | null
  /** What the cells are allowed to hold, where that may have changed. */
  validations?: readonly DataValidation[]
  /**
   * The links, where they may have changed.
   *
   * Written here rather than by the caller because half of a link lives in
   * the part's own relationships, and the two have to be written together or
   * the file has a link pointing at a relationship that is not there.
   */
  links?: readonly Hyperlink[]
}

/** Where a part keeps its relationships, which is beside it and under `_rels`. */
function relationshipsOf(path: string): string {
  const at = path.lastIndexOf('/')
  return `${path.slice(0, at)}/_rels/${path.slice(at + 1)}.rels`
}

const CALC_CHAIN_PART = 'xl/calcChain.xml'
const CALC_CHAIN_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain'

export interface SaveOptions {
  /**
   * Whether any cell changed, which is when `calcChain` stops being true.
   *
   * It lists the order Excel last recalculated the formulas in, and a stale
   * one makes Excel recalculate in the wrong order — or repair the file. It is
   * dropped rather than rebuilt: Excel writes a new one on its next
   * calculation, and building one here would mean having the dependency graph,
   * which is the formula engine's (`PLAN.md`, phase 3).
   */
  edited?: boolean
}

/**
 * Puts the cells back into the parts they came from.
 *
 * Only the cells. A worksheet carries column widths, conditional formatting,
 * a drawing reference and a dozen other things this does not rebuild, and it
 * keeps every one of them because the part is edited as text rather than
 * regenerated as a tree.
 */
export function writeWorkbook(
  pkg: OoxmlPackage,
  sheets: readonly SheetToWrite[],
  options: SaveOptions = {},
): void {
  for (const sheet of sheets) {
    const xml = getPartText(pkg, sheet.path)
    if (xml === undefined) continue

    let written = replaceSheetData(xml, sheet.cells)
    if (sheet.columns !== undefined) written = replaceColumns(written, sheet.columns)
    if (sheet.merges !== undefined) written = replaceMerges(written, sheet.merges)
    if (sheet.filter !== undefined) written = replaceAutoFilter(written, sheet.filter)
    if (sheet.validations !== undefined) {
      written = replaceValidations(written, writeValidations(sheet.validations))
    }

    if (sheet.links !== undefined) {
      const path = relationshipsOf(sheet.path)
      const relationships = parseRelationships(getPartText(pkg, path) ?? '')

      written = replaceHyperlinks(written, writeHyperlinks(sheet.links, relationships))
      // Written even where the list is empty: a part with no relationships
      // left is still a part Excel expects to find if the sheet names one.
      if (relationships.size > 0) setPartText(pkg, path, serializeRelationships(relationships))
    }

    setPartText(pkg, sheet.path, written)
  }

  if (options.edited === true) removeCalcChain(pkg)
}

/**
 * Takes `calcChain.xml` out of the package, with the two references to it.
 *
 * A part left behind in `[Content_Types].xml` or in the relationships is a
 * package Excel calls damaged, so all three go together or none do.
 */
export function removeCalcChain(pkg: OoxmlPackage): boolean {
  if (!pkg.parts.has(CALC_CHAIN_PART)) return false

  pkg.parts.delete(CALC_CHAIN_PART)

  const relationshipsPart = 'xl/_rels/workbook.xml.rels'
  const relationships = parseRelationships(getPartText(pkg, relationshipsPart) ?? '')

  for (const [id, relationship] of relationships) {
    if (relationship.type === CALC_CHAIN_TYPE) relationships.delete(id)
  }
  setPartText(pkg, relationshipsPart, serializeRelationships(relationships))

  const types = getPartText(pkg, '[Content_Types].xml')
  if (types !== undefined) {
    setPartText(
      pkg,
      '[Content_Types].xml',
      types.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/u, ''),
    )
  }

  return true
}
