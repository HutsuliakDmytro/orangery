import { getPartText, setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * `<calcPr>` — whether the workbook works itself out as it is typed into.
 *
 * Written back because it is the workbook's property rather than the
 * program's: somebody who put a model of a million formulas on manual did so
 * because of that model, and a file that forgot would recalculate for three
 * seconds on the next machine at the first keystroke.
 *
 * The element is patched rather than replaced. `<calcPr>` also carries
 * `calcId` — the version of Excel that last worked the workbook out — and
 * `iterate`, `fullCalcOnLoad` and half a dozen others; an element rebuilt
 * from the one attribute modelled here would throw the rest away.
 */

const WORKBOOK_PART = 'xl/workbook.xml'

/** How a workbook is worked out, written back over what the file said. */
export function writeCalculationMode(pkg: OoxmlPackage, manual: boolean): boolean {
  const xml = getPartText(pkg, WORKBOOK_PART)
  if (xml === undefined) return false

  setPartText(pkg, WORKBOOK_PART, replaceCalculationMode(xml, manual))
  return true
}

/**
 * The attribute set, cleared, or the element added to say it.
 *
 * Automatic is written as no attribute at all rather than as `calcMode="auto"`,
 * because that is what it means and what a workbook without one says. It also
 * means `autoNoTable` — automatic for everything but data tables — becomes
 * plain automatic when somebody switches back to it, which is the answer they
 * asked for: this program has no data tables to hold back.
 */
export function replaceCalculationMode(xml: string, manual: boolean): string {
  const existing = /<calcPr(\s[^>]*?)?\s*\/?>/u.exec(xml)

  if (existing !== null) {
    const attributes = (existing[1] ?? '').replace(/\s+calcMode="[^"]*"/u, '')
    const closing = existing[0].endsWith('/>') ? '/>' : '>'
    const written = `<calcPr${attributes}${manual ? ' calcMode="manual"' : ''}${closing}`

    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (!manual) return xml

  // Where the schema puts it: after the names, before the optional things
  // that follow. An element out of order is a file Excel offers to repair.
  const before = /<oleSize|<customWorkbookViews|<pivotCaches|<extLst/u.exec(xml)
  if (before !== null) {
    return `${xml.slice(0, before.index)}<calcPr calcMode="manual"/>${xml.slice(before.index)}`
  }

  const after = /<\/definedNames>|<\/sheets>/gu
  let last: RegExpExecArray | null = null
  for (let found = after.exec(xml); found !== null; found = after.exec(xml)) last = found

  if (last === null) return xml

  const at = last.index + last[0].length
  return `${xml.slice(0, at)}<calcPr calcMode="manual"/>${xml.slice(at)}`
}
