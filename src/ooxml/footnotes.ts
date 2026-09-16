import { attribute, buildXml, children, element, parseXml, tagName, withDeclaration } from './xml'
import type { XmlNode } from './xml'
import { parseIntAttribute } from './units'

/**
 * Footnotes — `word/footnotes.xml`.
 *
 * The body holds only a reference: `<w:footnoteReference w:id="3"/>` inside a
 * run. The note itself lives in the footnotes part, keyed by that id.
 *
 * Two ids are reserved and are not real notes: `-1` is the separator line Word
 * draws above the footnote area and `0` the continuation separator. Treating
 * them as notes puts two empty entries at the top of every document that has
 * ever had a footnote.
 */

export const FOOTNOTES_PART = 'word/footnotes.xml'
export const FOOTNOTES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'
export const FOOTNOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'

/** Ids Word reserves for the separator marks rather than for notes. */
export const RESERVED_FOOTNOTE_IDS = new Set([-1, 0])

export interface Footnote {
  id: number
  /** `separator`, `continuationSeparator`, or absent for a real note. */
  type: string | null
  paragraphs: XmlNode[]
}

export function isRealFootnote(footnote: Footnote): boolean {
  return footnote.type === null && !RESERVED_FOOTNOTE_IDS.has(footnote.id)
}

export function parseFootnotes(xml: string): Map<number, Footnote> {
  const footnotes = new Map<number, Footnote>()

  const root = parseXml(xml).find((node) => tagName(node) === 'w:footnotes')
  if (!root) return footnotes

  for (const node of children(root)) {
    if (tagName(node) !== 'w:footnote') continue

    const id = parseIntAttribute(attribute(node, 'w:id'))
    if (id === null) continue

    footnotes.set(id, {
      id,
      type: attribute(node, 'w:type') ?? null,
      paragraphs: children(node).filter((child) => tagName(child) === 'w:p'),
    })
  }

  return footnotes
}

export function serializeFootnotes(footnotes: Map<number, Footnote>): string {
  const nodes = [...footnotes.values()]
    // Word writes the separators first, then notes in id order.
    .sort((a, b) => a.id - b.id)
    .map((footnote) =>
      element(
        'w:footnote',
        {
          ...(footnote.type === null ? {} : { 'w:type': footnote.type }),
          'w:id': String(footnote.id),
        },
        footnote.paragraphs.length > 0 ? footnote.paragraphs : [element('w:p')],
      ),
    )

  return withDeclaration(
    buildXml([
      element(
        'w:footnotes',
        {
          'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        },
        nodes,
      ),
    ]),
  )
}

/** Next free id, skipping the reserved ones. */
export function nextFootnoteId(footnotes: Map<number, Footnote>): number {
  let candidate = 1
  while (footnotes.has(candidate)) candidate += 1
  return candidate
}

/** The separator notes Word puts at the top of a fresh footnotes part. */
export function separatorFootnotes(): Map<number, Footnote> {
  const separatorRun = (mark: string) =>
    element('w:p', {}, [
      element('w:pPr', {}, [
        element('w:spacing', { 'w:after': '0', 'w:line': '240', 'w:lineRule': 'auto' }),
      ]),
      element('w:r', {}, [element(mark)]),
    ])

  return new Map([
    [-1, { id: -1, type: 'separator', paragraphs: [separatorRun('w:separator')] }],
    [
      0,
      {
        id: 0,
        type: 'continuationSeparator',
        paragraphs: [separatorRun('w:continuationSeparator')],
      },
    ],
  ])
}

/** The run that marks a footnote in the body text. */
export function footnoteReferenceRun(id: number): XmlNode {
  return element('w:r', {}, [
    // `FootnoteReference` is the character style Word applies to the superscript
    // marker; without it the number renders inline at full size.
    element('w:rPr', {}, [element('w:rStyle', { 'w:val': 'FootnoteReference' })]),
    element('w:footnoteReference', { 'w:id': String(id) }),
  ])
}

/** A note's body paragraph, with the marker Word puts before the text. */
export function footnoteParagraph(text: string): XmlNode {
  return element('w:p', {}, [
    element('w:pPr', {}, [element('w:pStyle', { 'w:val': 'FootnoteText' })]),
    element('w:r', {}, [
      element('w:rPr', {}, [element('w:rStyle', { 'w:val': 'FootnoteReference' })]),
      element('w:footnoteRef'),
    ]),
    element('w:r', {}, [element('w:t', { 'xml:space': 'preserve' }, [{ '#text': ` ${text}` }])]),
  ])
}

/** Plain text of a note, for showing it in the editor. */
export function footnoteText(footnote: Footnote): string {
  const collect = (node: XmlNode): string => {
    if ('#text' in node) {
      const value = node['#text']
      return typeof value === 'string' ? value : ''
    }
    return children(node).map(collect).join('')
  }

  return footnote.paragraphs.map(collect).join('\n').trim()
}
