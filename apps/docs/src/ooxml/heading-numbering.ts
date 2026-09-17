import {
  attribute,
  children,
  element,
  findChild,
  parseXml,
  pointsToTwips,
  serializeNode,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { HeadingNumberScheme } from '../editor/heading-numbers'

/**
 * Numbering the heading styles in a DOCX.
 *
 * Word attaches the numbering to the *styles* rather than to the paragraphs: a
 * definition in `numbering.xml` names a heading style at each of its levels,
 * and each heading style points back at it. Every heading is then numbered by
 * belonging to its style, so a new one is numbered the moment it is typed and
 * nothing has to be written onto the paragraph.
 *
 * The alternative — a `w:numPr` on every heading paragraph — produces the same
 * page but a file that no longer says the headings are numbered, only that
 * these particular paragraphs are.
 */

/** The marker this app writes as belonging to it, so it can be replaced. */
export const HEADING_ABSTRACT_NAME = 'OrangeryHeadings'

export const HEADING_STYLE_IDS = Array.from({ length: 9 }, (_unused, index) =>
  index === 0 ? 'Heading1' : `Heading${String(index + 1)}`,
)

/** Word's own outline gallery, level by level. */
const OUTLINE_FORMATS = ['upperRoman', 'upperLetter', 'decimal', 'lowerLetter', 'lowerRoman']
const OUTLINE_SUFFIXES = ['.', '.', '.', ')', ')']

const INDENT_STEP_PT = 18

function levelFor(scheme: HeadingNumberScheme, level: number): XmlNode {
  const cycle = level % OUTLINE_FORMATS.length

  const format = scheme === 'decimal' ? 'decimal' : (OUTLINE_FORMATS[cycle] ?? 'decimal')
  // A legal-style number carries every level above it — `%1.%2.%3.` — while the
  // outline gallery states only its own.
  const text =
    scheme === 'decimal'
      ? `${Array.from({ length: level + 1 }, (_unused, index) => `%${String(index + 1)}`).join('.')}.`
      : `%${String(level + 1)}${OUTLINE_SUFFIXES[cycle] ?? '.'}`

  return element('w:lvl', { 'w:ilvl': String(level) }, [
    element('w:start', { 'w:val': '1' }),
    element('w:numFmt', { 'w:val': format }),
    // The style this level numbers. It is what ties the definition to the
    // headings, and what Word reads back as "linked to headings".
    element('w:pStyle', { 'w:val': HEADING_STYLE_IDS[level] ?? 'Heading1' }),
    element('w:lvlText', { 'w:val': text }),
    element('w:lvlJc', { 'w:val': 'left' }),
    element('w:pPr', {}, [
      element('w:ind', {
        'w:left': String(pointsToTwips(INDENT_STEP_PT * level)),
        'w:hanging': '0',
      }),
    ]),
  ])
}

export function buildHeadingAbstractNum(id: number, scheme: HeadingNumberScheme): XmlNode {
  return element('w:abstractNum', { 'w:abstractNumId': String(id) }, [
    // Named so a later save can tell this definition apart from one the user's
    // own document brought with it, and replace only its own.
    element('w:nsid', { 'w:val': '0A0A0A0A' }),
    element('w:multiLevelType', { 'w:val': 'multilevel' }),
    element('w:tmpl', { 'w:val': '0A0A0A0A' }),
    element('w:name', { 'w:val': HEADING_ABSTRACT_NAME }),
    ...Array.from({ length: 9 }, (_unused, level) => levelFor(scheme, level)),
  ])
}

/** Whether an abstract numbering definition is the one this app writes. */
export function isHeadingAbstractNum(node: XmlNode): boolean {
  const name = findChild(node, 'w:name')
  return name !== undefined && attribute(name, 'w:val') === HEADING_ABSTRACT_NAME
}

/**
 * The scheme a definition describes, read back from its first level.
 *
 * `%1.%2.` at the second level means every level above is carried; a bare
 * `%2.` means each level stands alone.
 */
export function schemeOf(abstractNum: XmlNode): HeadingNumberScheme {
  const second = children(abstractNum).find(
    (node) => tagName(node) === 'w:lvl' && attribute(node, 'w:ilvl') === '1',
  )

  const text = second === undefined ? undefined : findChild(second, 'w:lvlText')
  return (text === undefined ? '' : (attribute(text, 'w:val') ?? '')).includes('%1')
    ? 'decimal'
    : 'outline'
}

/**
 * Puts a `w:numPr` on a heading style, or takes it off.
 *
 * The rest of the style is left exactly as it was: a heading carries the
 * document's fonts and spacing, and rebuilding it to change one child would
 * lose whatever else the file declared.
 */
export function withHeadingNumbering(
  styleXml: string,
  numId: number | null,
  level: number,
): string {
  const parsed = parseXml(styleXml)
  const style = parsed.find((node) => tagName(node) === 'w:style')
  if (!style) return styleXml

  const existing = children(style)
  const pPr = existing.find((node) => tagName(node) === 'w:pPr')

  const keep = (nodes: readonly XmlNode[]) => nodes.filter((node) => tagName(node) !== 'w:numPr')

  const numbering =
    numId === null
      ? []
      : [
          element('w:numPr', {}, [
            element('w:ilvl', { 'w:val': String(level) }),
            element('w:numId', { 'w:val': String(numId) }),
          ]),
        ]

  // `w:numPr` comes first among the paragraph properties Word writes here.
  const rebuiltPPr = element('w:pPr', {}, [...numbering, ...keep(pPr ? children(pPr) : [])])

  const rebuilt = pPr
    ? existing.map((node) => (node === pPr ? rebuiltPPr : node))
    : insertParagraphProperties(existing, rebuiltPPr)

  return serializeNode(element('w:style', attributesOf(style), rebuilt))
}

/** `w:pPr` follows the style's own naming elements and precedes `w:rPr`. */
function insertParagraphProperties(existing: readonly XmlNode[], pPr: XmlNode): XmlNode[] {
  const index = existing.findIndex((node) => tagName(node) === 'w:rPr')
  if (index === -1) return [...existing, pPr]

  return [...existing.slice(0, index), pPr, ...existing.slice(index)]
}

function attributesOf(node: XmlNode): Record<string, string> {
  const raw = node[':@']
  if (typeof raw !== 'object' || raw === null) return {}

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key.replace(/^@_/u, '')] = String(value)
  }
  return result
}
