import {
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { replaceSheetData } from './sheet-data'
import type { SheetCells } from './cells'

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

    setPartText(pkg, sheet.path, replaceSheetData(xml, sheet.cells))
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
