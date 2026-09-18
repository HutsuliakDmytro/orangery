import {
  addRelationship,
  attribute,
  buildXml,
  children,
  element,
  ensureOverride,
  getPartText,
  isTextNode,
  parseRelationships,
  parseXml,
  serializeRelationships,
  setPartText,
  tagName,
  textValue,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import type { Slide } from './deck'
import { relsPartFor } from './insert-picture'
import {
  COMMENT_AUTHORS_RELATIONSHIP,
  COMMENTS_RELATIONSHIP,
  PRESENTATION_RELS_PART,
} from './parts'
import { readPresentation } from './presentation'

/**
 * What people have said about a slide.
 *
 * There are two formats. The original one is a flat list per slide with the
 * authors kept once for the deck; the one PowerPoint has written since 2018 is
 * a different namespace with threads, statuses and a GUID for everything.
 *
 * Both are read, because a deck edited by two versions of PowerPoint has both
 * and a reader that knew one would report half a conversation. Only the first
 * is written: every version of PowerPoint since 2007 understands it, and the
 * newer one asks for GUIDs, a second authors part and a reply structure — a
 * lot of markup to get exactly right for a comment that reads the same either
 * way.
 *
 * So a comment made here is a comment PowerPoint shows, and a thread made in
 * PowerPoint is a thread this shows and does not pretend to be able to answer.
 */

export interface CommentAuthor {
  name: string
  initials: string
}

export interface Comment {
  /** Unique within its slide, which is all anything here needs. */
  id: string
  author: CommentAuthor
  text: string
  /** ISO 8601 as the file states it, or null where it states none. */
  created: string | null
  /** True for a thread somebody has marked as dealt with. */
  resolved: boolean
  /** Whether this app can change it, which the newer format's are not. */
  editable: boolean
}

const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml'
const AUTHORS_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml'

/** The words in an element, however deep they are. */
const textOf = (node: XmlNode): string =>
  children(node)
    .map((child) => (isTextNode(child) ? textValue(child) : textOf(child)))
    .join('')

/**
 * The element a part is, past the declaration.
 *
 * `parseXml` hands back the `<?xml?>` node as a root like any other, and a
 * reader that took the first one would find a comment list only in the files
 * that happen not to have a declaration.
 */
const rootOf = (text: string): XmlNode | undefined =>
  parseXml(text).find((node) => !(tagName(node) ?? '?').startsWith('?'))

/** Every descendant with a local name, whatever prefix it carries. */
function named(node: XmlNode, local: string): XmlNode[] {
  return children(node).flatMap((child) => [
    ...((tagName(child) ?? '').replace(/^[^:]*:/u, '') === local ? [child] : []),
    ...named(child, local),
  ])
}

/** The authors of the deck, by the id a comment names them with. */
export function readCommentAuthors(pkg: OoxmlPackage): Map<string, CommentAuthor> {
  const map = readPresentation(pkg)
  const authors = new Map<string, CommentAuthor>()

  for (const path of map.commentAuthors) {
    const root = rootOf(getPartText(pkg, path) ?? '')
    if (root === undefined) continue

    for (const author of named(root, 'cmAuthor').concat(named(root, 'author'))) {
      const id = attribute(author, 'id')
      if (id === undefined) continue

      authors.set(id, {
        name: attribute(author, 'name') ?? 'Someone',
        initials: attribute(author, 'initials') ?? '',
      })
    }
  }

  return authors
}

/** The comment parts of a slide, old and modern, in the order the map lists them. */
function partsOf(pkg: OoxmlPackage, slide: Slide): string[] {
  const map = readPresentation(pkg)
  return map.slides.find((one) => one.path === slide.path)?.comments ?? []
}

function readPart(
  pkg: OoxmlPackage,
  path: string,
  authors: ReadonlyMap<string, CommentAuthor>,
): Comment[] {
  const root = rootOf(getPartText(pkg, path) ?? '')
  if (root === undefined) return []

  // The newer format nests replies inside their comment; each is read as its
  // own remark, because a list of what was said is what a person wants and a
  // thread this app cannot answer is not worth drawing as one.
  const modern = (tagName(root) ?? '').startsWith('p188:')

  return named(root, 'cm').map((comment, index) => {
    // `idx` in the original format and `id` in the newer one; both are what
    // the file calls this comment, and neither is ours to invent.
    const id = attribute(comment, 'idx') ?? attribute(comment, 'id') ?? String(index)
    const authorId = attribute(comment, 'authorId') ?? ''
    const body = named(comment, 'txBody')[0]

    return {
      id,
      author: authors.get(authorId) ?? { name: 'Someone', initials: '' },
      text: body === undefined ? textOf(named(comment, 'text')[0] ?? comment) : textOf(body),
      created: attribute(comment, 'created') ?? attribute(comment, 'dt') ?? null,
      resolved: attribute(comment, 'status') === 'resolved',
      editable: !modern,
    }
  })
}

/** Everything said about a slide, from whichever formats the deck uses. */
export function readComments(pkg: OoxmlPackage, slide: Slide): Comment[] {
  const authors = readCommentAuthors(pkg)
  return partsOf(pkg, slide).flatMap((path) => readPart(pkg, path, authors))
}

/** The next free `ppt/comments/commentN.xml`. */
function nextCommentPart(pkg: OoxmlPackage): string {
  let highest = 0
  for (const path of pkg.parts.keys()) {
    const match = /^ppt\/comments\/comment(\d+)\.xml$/u.exec(path)
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]))
  }
  return `ppt/comments/comment${String(highest + 1)}.xml`
}

const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'

/** Makes sure the deck names the person, and answers the id it names them by. */
function authorId(pkg: OoxmlPackage, author: CommentAuthor): string {
  const existing = [...readCommentAuthors(pkg)].find(([, one]) => one.name === author.name)
  if (existing !== undefined) return existing[0]

  const path = 'ppt/commentAuthors.xml'
  const roots = parseXml(getPartText(pkg, path) ?? '')
  const list =
    roots.find((node) => tagName(node) === 'p:cmAuthorLst') ??
    element('p:cmAuthorLst', { 'xmlns:p': P_NS })

  const used = children(list).map((one) => Number(attribute(one, 'id')))
  const id = String(Math.max(-1, ...used.filter((value) => Number.isFinite(value))) + 1)

  children(list).push(
    element('p:cmAuthor', {
      id,
      name: author.name,
      initials: author.initials,
      lastIdx: '1',
      // The colour PowerPoint gives each person's marks; nothing here draws
      // them, and a deck that opens there wants one.
      clrIdx: id,
    }),
  )

  setPartText(pkg, path, withDeclaration(buildXml(roots.includes(list) ? roots : [list])))
  ensureOverride(pkg, path, AUTHORS_TYPE)

  const relationships = parseRelationships(getPartText(pkg, PRESENTATION_RELS_PART) ?? '')
  const named_ = [...relationships.values()].some(
    (one) => one.type === COMMENT_AUTHORS_RELATIONSHIP,
  )
  if (!named_) {
    addRelationship(relationships, COMMENT_AUTHORS_RELATIONSHIP, 'commentAuthors.xml')
    setPartText(pkg, PRESENTATION_RELS_PART, serializeRelationships(relationships))
  }

  return id
}

export interface NewComment {
  author: CommentAuthor
  text: string
  /** Where the marker sits, in the slide's own units. */
  at?: { x: number; y: number }
}

/**
 * Adds a comment to a slide. Returns its id.
 *
 * Written in the original format, which every version of PowerPoint since 2007
 * reads. A deck that already carries the newer kind keeps them; the two live
 * side by side there as they do in PowerPoint.
 */
export function addComment(pkg: OoxmlPackage, slide: Slide, comment: NewComment): string | null {
  if (comment.text.trim() === '') return null

  const author = authorId(pkg, comment.author)

  // The old comment parts of this slide, if it has one; the newer kind is left
  // alone because nothing here writes it.
  const existing = partsOf(pkg, slide).find(
    (path) => tagName(rootOf(getPartText(pkg, path) ?? '') ?? {}) === 'p:cmLst',
  )

  const path = existing ?? nextCommentPart(pkg)
  const roots = parseXml(getPartText(pkg, path) ?? '')
  const list =
    roots.find((node) => tagName(node) === 'p:cmLst') ?? element('p:cmLst', { 'xmlns:p': P_NS })

  const used = children(list).map((one) => Number(attribute(one, 'idx')))
  const id = String(Math.max(0, ...used.filter((value) => Number.isFinite(value))) + 1)
  const at = comment.at ?? { x: 0, y: 0 }

  children(list).push(
    element('p:cm', { authorId: author, dt: new Date().toISOString(), idx: id }, [
      element('p:pos', { x: String(Math.round(at.x)), y: String(Math.round(at.y)) }),
      element('p:text', {}, [{ '#text': comment.text }]),
    ]),
  )

  setPartText(pkg, path, withDeclaration(buildXml(roots.includes(list) ? roots : [list])))

  if (existing === undefined) {
    ensureOverride(pkg, path, COMMENTS_TYPE)
    const relsPart = relsPartFor(slide.path)
    const relationships = parseRelationships(getPartText(pkg, relsPart) ?? '')
    addRelationship(
      relationships,
      COMMENTS_RELATIONSHIP,
      `../comments/${path.split('/').pop() ?? 'comment1.xml'}`,
    )
    setPartText(pkg, relsPart, serializeRelationships(relationships))
  }

  return id
}

/**
 * Takes a comment off a slide.
 *
 * Only one this app wrote the format of. A thread from a newer PowerPoint is
 * left alone rather than half-deleted: removing one remark from a structure
 * with statuses and replies is not the same operation, and doing it badly would
 * lose the rest of the conversation.
 */
export function removeComment(pkg: OoxmlPackage, slide: Slide, id: string): boolean {
  for (const path of partsOf(pkg, slide)) {
    const roots = parseXml(getPartText(pkg, path) ?? '')
    const list = roots.find((node) => tagName(node) === 'p:cmLst')
    if (list === undefined) continue

    const nodes = children(list)
    const at = nodes.findIndex((one) => attribute(one, 'idx') === id)
    if (at === -1) continue

    nodes.splice(at, 1)
    setPartText(pkg, path, withDeclaration(buildXml(roots)))
    return true
  }

  return false
}

/** Whether the deck names a comment part at all, for a pane that has to decide. */
export function hasComments(pkg: OoxmlPackage): boolean {
  return readPresentation(pkg).slides.some((slide) => slide.comments.length > 0)
}
