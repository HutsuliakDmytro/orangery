import {
  attribute,
  children,
  element,
  parseIntAttribute,
  parseXml,
  serializeNode,
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
}

/** Text of a comment's paragraphs, with the runs flattened into lines. */
function textOf(comment: XmlNode): string {
  const lines: string[] = []

  for (const paragraph of children(comment)) {
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

    comments.set(id, {
      id,
      author: attribute(child, 'w:author') ?? '',
      initials: attribute(child, 'w:initials') ?? '',
      date: attribute(child, 'w:date') ?? '',
      text: textOf(child),
    })
  }

  return comments
}

/** A comment as the part stores it: one paragraph per line, styled as Word does. */
function buildComment(comment: Comment): XmlNode {
  const lines = comment.text.split('\n')

  return element(
    'w:comment',
    {
      'w:id': String(comment.id),
      'w:author': comment.author,
      ...(comment.initials === '' ? {} : { 'w:initials': comment.initials }),
      ...(comment.date === '' ? {} : { 'w:date': comment.date }),
    },
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

export function serializeComments(comments: ReadonlyMap<number, Comment>): string {
  const root = element(
    'w:comments',
    {
      'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    },
    [...comments.values()].sort((a, b) => a.id - b.id).map(buildComment),
  )

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${serializeNode(root)}`
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
export function referenceRun(id: number): XmlNode {
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
