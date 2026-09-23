import {
  attribute,
  attributes,
  children,
  element,
  parseIntAttribute,
  parseXml,
  preservingRoot,
  tagName,
  textNode,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * Comments — `word/comments.xml` and the markers that anchor them.
 *
 * A comment lives in its own part; the body only says where it applies, with a
 * `w:commentRangeStart` and `w:commentRangeEnd` around the text and a run
 * carrying `w:commentReference`. All three share an id, and a comment missing
 * any of them is one Word shows nowhere.
 */

export const COMMENTS_PART = 'word/comments.xml'
export const COMMENTS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
export const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'

export interface Comment {
  id: number
  author: string
  /** Shown beside the author; Word puts them on the bubble. */
  initials: string
  /** ISO timestamp, or empty when the file states none. */
  date: string
  text: string
  /**
   * The comment's paragraphs as the file wrote them.
   *
   * Kept for the same reason a footnote's are: a comment is a stretch of
   * WordprocessingML, and the panel edits the words in it. Rebuilding one from
   * its text writes our idea of a comment — `w:pStyle w:val="CommentText"`,
   * `w:rStyle w:val="CommentReference"` — over the file's own, and a document
   * whose styles are called `a5` and `a6`, which is what LibreOffice and Word
   * in several locales write, comes back renamed with any formatting inside
   * the comment flattened.
   *
   * Written back untouched while the text is what it was. Absent for a
   * comment somebody has just made, which has no original to keep.
   */
  paragraphs?: XmlNode[]
  /** Attributes of `w:comment` this does not model, kept so they survive. */
  carried?: Record<string, string> | null
}

/** What `w:comment` states that this models; the rest is carried. */
const MODELLED_COMMENT = new Set(['w:id', 'w:author', 'w:initials', 'w:date'])

/** Text of a comment's paragraphs, with the runs flattened into lines. */
function textOf(comment: XmlNode): string {
  return textOfParagraphs(children(comment))
}

/** The same, for paragraphs already taken out of the comment that held them. */
function textOfParagraphs(nodes: readonly XmlNode[]): string {
  const lines: string[] = []

  for (const paragraph of nodes) {
    if (tagName(paragraph) !== 'w:p') continue

    let line = ''
    const walk = (node: XmlNode): void => {
      if ('#text' in node) return
      if (tagName(node) === 'w:t') {
        line += children(node)
          .map((part) => ('#text' in part ? String(part['#text']) : ''))
          .join('')
        return
      }
      for (const child of children(node)) walk(child)
    }

    for (const child of children(paragraph)) walk(child)
    lines.push(line)
  }

  return lines.join('\n')
}

export function parseComments(xml: string): Map<number, Comment> {
  const comments = new Map<number, Comment>()

  const root = parseXml(xml).find((node) => tagName(node) === 'w:comments')
  if (!root) return comments

  for (const child of children(root)) {
    if (tagName(child) !== 'w:comment') continue

    const id = parseIntAttribute(attribute(child, 'w:id'))
    if (id === null) continue

    const rest = Object.entries(attributes(child)).filter(([name]) => !MODELLED_COMMENT.has(name))

    comments.set(id, {
      id,
      author: attribute(child, 'w:author') ?? '',
      initials: attribute(child, 'w:initials') ?? '',
      date: attribute(child, 'w:date') ?? '',
      text: textOf(child),
      paragraphs: children(child).filter((node) => tagName(node) === 'w:p'),
      carried: rest.length === 0 ? null : Object.fromEntries(rest),
    })
  }

  return comments
}

/**
 * A comment as the part stores it.
 *
 * Untouched while the words are the ones the file had: the paragraphs go back
 * exactly as they came, with whatever styles, formatting and markup nobody
 * here models. Only a comment somebody edited is rebuilt, and then it is
 * rebuilt as Word writes one — which is the best guess available once the
 * original paragraphs no longer say the right thing.
 */
function buildComment(comment: Comment): XmlNode {
  const lines = comment.text.split('\n')

  const stated = {
    'w:id': String(comment.id),
    'w:author': comment.author,
    ...(comment.initials === '' ? {} : { 'w:initials': comment.initials }),
    ...(comment.date === '' ? {} : { 'w:date': comment.date }),
    ...(comment.carried ?? {}),
  }

  const original = comment.paragraphs ?? []
  if (original.length > 0 && textOfParagraphs(original) === comment.text) {
    return element('w:comment', stated, original)
  }

  return element(
    'w:comment',
    stated,
    lines.map((line) =>
      element('w:p', {}, [
        element('w:pPr', {}, [element('w:pStyle', { 'w:val': 'CommentText' })]),
        element('w:r', {}, [
          // Word marks the reference inside the comment itself, which is what
          // draws the little number in front of the text.
          element('w:rPr', {}, [element('w:rStyle', { 'w:val': 'CommentReference' })]),
          element('w:annotationRef'),
        ]),
        element('w:r', {}, [element('w:t', { 'xml:space': 'preserve' }, [textNode(line)])]),
      ]),
    ),
  )
}

export function serializeComments(
  comments: ReadonlyMap<number, Comment>,
  previous?: string,
): string {
  const root = element(
    'w:comments',
    {
      'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    },
    [...comments.values()].sort((a, b) => a.id - b.id).map(buildComment),
  )

  // Word declares a dozen namespaces on this root and a comment may use any of
  // them; the file's own root is kept and ours only fills in what it lacked.
  return preservingRoot(previous, [root])
}

/** The markers that anchor a comment to a stretch of text. */
export function rangeStart(id: number): XmlNode {
  return element('w:commentRangeStart', { 'w:id': String(id) })
}

export function rangeEnd(id: number): XmlNode {
  return element('w:commentRangeEnd', { 'w:id': String(id) })
}

/**
 * The run that carries the reference.
 *
 * It comes after the range end, and without it Word shows no bubble at all —
 * the range alone marks text that belongs to a comment nobody can open.
 */
export function referenceRun(id: number, original?: string): XmlNode {
  // The file's own run where there was one: its `w:rStyle` names a style in
  // this document's `styles.xml`, which is `CommentReference` in a Word
  // document written in English and `a5` in plenty of others.
  if (original !== undefined && original !== '') {
    const parsed = parseXml(original).find((node) => tagName(node) === 'w:r')
    if (parsed !== undefined) return parsed
  }

  return element('w:r', {}, [
    element('w:rPr', {}, [element('w:rStyle', { 'w:val': 'CommentReference' })]),
    element('w:commentReference', { 'w:id': String(id) }),
  ])
}

/** The next id no comment is using. */
export function nextCommentId(comments: ReadonlyMap<number, Comment>): number {
  let candidate = 0
  while (comments.has(candidate)) candidate += 1
  return candidate
}
