import { getPartText, setPartText } from '@orangery/ooxml-core'
import { workbookPart } from './parts'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { DefinedName } from './workbook'

/**
 * `<definedNames>` — the names a workbook gives to formulas.
 *
 * A name is not a cell and not a range: it is a formula somebody has named,
 * which is why `Tax_Rate` can stand for `0.2` and `Sales` for a column. That
 * is worth remembering when writing them back — there is nothing to validate
 * beyond the name itself, because the thing it stands for is a formula and
 * this is not the place that works formulas out.
 *
 * Patched as text like everything else in a workbook part. The element goes
 * after `<sheets>` and before `<calcPr>`, which is where the schema puts it:
 * an element out of order is a file Excel offers to repair.
 */

const escaped = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')

/**
 * Whether a name is one a workbook will accept.
 *
 * Excel's rules, and each of them is there for a reason a person meets: a
 * name that looks like a reference would be ambiguous in every formula that
 * used it, a name with a space in it would end where the space is, and the
 * single letters `R` and `C` are taken by the other way of writing
 * references.
 */
export function isValidName(name: string): boolean {
  if (name === '' || name.length > 255) return false
  if (!/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/u.test(name)) return false
  if (/^[RrCc]$/u.test(name)) return false

  // `A1`, `$B$2`, `AB12` — anything that could be read as a cell instead.
  return !/^\$?[A-Za-z]{1,3}\$?\d{1,7}$/u.test(name)
}

/** The names of a workbook, written back in place of the ones it had. */
export function writeDefinedNames(pkg: OoxmlPackage, names: readonly DefinedName[]): boolean {
  const xml = getPartText(pkg, workbookPart(pkg))
  if (xml === undefined) return false

  const written =
    names.length === 0
      ? ''
      : `<definedNames>${names
          .map((one) => {
            const scope = one.sheet === null ? '' : ` localSheetId="${String(one.sheet)}"`
            const hidden = one.hidden ? ' hidden="1"' : ''
            return `<definedName name="${escaped(one.name)}"${scope}${hidden}>${escaped(
              one.formula,
            )}</definedName>`
          })
          .join('')}</definedNames>`

  setPartText(pkg, workbookPart(pkg), replaceDefinedNames(xml, written))
  return true
}

/** The element put where the schema says it goes. */
export function replaceDefinedNames(xml: string, written: string): string {
  const existing = /<definedNames(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/definedNames>)/u.exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  // After the sheets — which every workbook has — and before whatever of the
  // optional things that follow it is there.
  const before = /<calcPr|<oleSize|<customWorkbookViews|<pivotCaches|<extLst/u.exec(xml)
  if (before !== null) return xml.slice(0, before.index) + written + xml.slice(before.index)

  const sheets = /<\/sheets>/u.exec(xml)
  if (sheets !== null) {
    const at = sheets.index + sheets[0].length
    return xml.slice(0, at) + written + xml.slice(at)
  }

  return xml
}
