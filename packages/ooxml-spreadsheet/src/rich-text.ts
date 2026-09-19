import { children, getPartText, parseXml, tagName } from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { readPartialFont } from './styles'
import type { Font } from './styles'
import { textOf } from './workbook'

/**
 * A cell's words, where not all of them look the same.
 *
 * A cell has one style, so a cell cannot be half bold. What can be half bold
 * is the string in it: `<si>` and `<is>` hold runs, each with its own `<rPr>`,
 * and that is how "Total: **1 234**" is one cell.
 *
 * The run's font is partial and has to be. A run that only reddens its words
 * says nothing about bold, and filling that gap with `false` would straighten
 * every heading it appeared in — the same rule a `dxf` follows, and the same
 * reader.
 */

export interface TextRun {
  text: string
  /** Only what the run's own `<rPr>` states. */
  font: Partial<Font>
}

export interface RichText {
  /** The words, joined, which is what most callers want. */
  text: string
  /**
   * The runs, or null where the string is one piece that says nothing about
   * itself — which is nearly every string in nearly every workbook.
   */
  runs: TextRun[] | null
  /**
   * The markup this was read from, where it came from inside a cell.
   *
   * Kept so an inline string is written back exactly as it arrived. Rebuilding
   * an `<rPr>` from a partial font would be a rebuild of everything in it that
   * this does not model — a phonetic reading, a font family index — and the
   * ADR is clear about what that costs
   * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`).
   */
  source: string | null
}

/** A string made of one plain piece, which needs no runs to describe it. */
export const plainText = (text: string): RichText => ({ text, runs: null, source: null })

/**
 * The runs of an `<si>` or an `<is>`.
 *
 * A single `<t>` with no `<r>` around it is a plain string and says so by
 * having no runs: the caller draws it with the cell's own style and never asks
 * what the pieces were.
 */
export function readRichText(node: XmlNode, source: string | null = null): RichText {
  const runs = children(node).filter((child) => tagName(child) === 'r')
  if (runs.length === 0) return { text: textOf(node), runs: null, source }

  const read = runs.map((run) => {
    const properties = children(run).find((child) => tagName(child) === 'rPr')

    return {
      // Every `<t>` of the run, which is one of them in every file anybody has
      // written, and is joined rather than assumed.
      text: children(run)
        .filter((child) => tagName(child) === 't')
        .map((child) => textOf(child))
        .join(''),
      font: properties === undefined ? {} : readPartialFont(properties),
    }
  })

  return { text: read.map((run) => run.text).join(''), runs: read, source }
}

/**
 * The shared string table, with the formatting each entry carries.
 *
 * Read once when a workbook is opened: the table holds one entry per distinct
 * string, however many cells point at it, so this is work proportional to the
 * words in the file rather than to the cells.
 */
export function readRichStrings(pkg: OoxmlPackage): RichText[] {
  const root = parseXml(getPartText(pkg, 'xl/sharedStrings.xml') ?? '').find(
    (node) => tagName(node) === 'sst',
  )
  if (root === undefined) return []

  return children(root)
    .filter((child) => tagName(child) === 'si')
    .map((entry) => readRichText(entry))
}
