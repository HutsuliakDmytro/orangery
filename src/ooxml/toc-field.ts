import { element, textNode } from './xml'
import type { XmlNode } from './xml'

/**
 * The table of contents as a Word field.
 *
 * Word models a TOC as a *complex field*: a `begin` marker, the field code, a
 * `separate` marker, the cached result, and an `end` marker. The cached result
 * is what every reader shows until someone asks Word to update the field.
 *
 * Writing our own block instead would produce text that Word's "Update Table of
 * Contents" cannot touch, and that other editors show as ordinary paragraphs.
 *
 * The field spans paragraphs: `begin` opens in the first, `end` closes in the
 * last. That is how Word writes it, and a field closed in the wrong paragraph
 * makes Word repair the document.
 */

export interface TocEntry {
  level: number
  text: string
}

/**
 * The field code.
 *
 * `\o "1-3"` includes heading levels 1 to 3, `\h` makes the entries hyperlinks,
 * `\z` hides tab leaders in web view, `\u` uses the outline level. This is the
 * switch set Word's own Insert → Table of Contents produces.
 */
export function fieldCode(maxLevel: number): string {
  return ` TOC \\o "1-${String(Math.min(9, Math.max(1, maxLevel)))}" \\h \\z \\u `
}

function run(children: XmlNode[]): XmlNode {
  return element('w:r', {}, children)
}

function fieldChar(type: 'begin' | 'separate' | 'end'): XmlNode {
  return run([
    element('w:fldChar', {
      'w:fldCharType': type,
      // `dirty` asks Word to refresh the field when the document opens, so the
      // cached result never lingers after the headings have changed.
      ...(type === 'begin' ? { 'w:dirty': 'true' } : {}),
    }),
  ])
}

function entryParagraph(entry: TocEntry, before: XmlNode[] = [], after: XmlNode[] = []): XmlNode {
  // Word styles TOC entries by level: TOC1, TOC2, and so on.
  const style = `TOC${String(Math.min(9, Math.max(1, entry.level)))}`

  return element('w:p', {}, [
    element('w:pPr', {}, [element('w:pStyle', { 'w:val': style })]),
    ...before,
    run([element('w:t', { 'xml:space': 'preserve' }, [textNode(entry.text)])]),
    ...after,
  ])
}

/**
 * Builds the paragraphs of a table of contents field.
 *
 * An empty table of contents still produces the field, so Word can fill it in;
 * a document that has no headings yet is a normal state, not an error.
 */
export function buildTocField(entries: readonly TocEntry[], maxLevel = 3): XmlNode[] {
  const opening = [
    fieldChar('begin'),
    run([element('w:instrText', { 'xml:space': 'preserve' }, [textNode(fieldCode(maxLevel))])]),
    fieldChar('separate'),
  ]

  if (entries.length === 0) {
    // Everything in one paragraph: there is no cached result to carry.
    return [
      element('w:p', {}, [
        element('w:pPr', {}, [element('w:pStyle', { 'w:val': 'TOC1' })]),
        ...opening,
        fieldChar('end'),
      ]),
    ]
  }

  // The field opens inside the first entry's paragraph and closes inside the
  // last one, which is how Word writes it. With a single entry that is the same
  // paragraph.
  return entries.map((entry, index) =>
    entryParagraph(
      entry,
      index === 0 ? opening : [],
      index === entries.length - 1 ? [fieldChar('end')] : [],
    ),
  )
}
