import {
  addRelationship,
  attribute,
  buildXml,
  children,
  element,
  ensureChild,
  ensureOverride,
  getPartText,
  isTextNode,
  parseRelationships,
  parseXml,
  serializeRelationships,
  setAttribute,
  setPartText,
  tagName,
  textValue,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import type { Slide } from './deck'
import { relsPartFor } from './insert-picture'
import { COMMENT_AUTHORS_RELATIONSHIP, COMMENTS_RELATIONSHIP, presentationRelsPart } from './parts'
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
 * A thread, though, is something the old format cannot say at all: it has no
 * replies and no status. So those are patched where PowerPoint has already
 * written them — a reply is one element appended beside the ones already
 * there, and resolving is one attribute — while a new remark is still written
 * in the old format. Everything written into the newer one is modelled on what
 * is in the file next to it, rather than invented from a schema nobody
 * publishes.
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
  /** Whether this app can delete it, which the newer format's are not. */
  editable: boolean
  /**
   * What was said in answer.
   *
   * Always empty for the older format, which has no such thing: a conversation
   * there is several remarks that happen to be about the same slide.
   */
  replies: Comment[]
  /** Whether this app can add to it — true for a thread PowerPoint started. */
  threaded: boolean
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

function readOne(
  comment: XmlNode,
  index: number,
  modern: boolean,
  authors: ReadonlyMap<string, CommentAuthor>,
): Comment {
  const id = attribute(comment, 'idx') ?? attribute(comment, 'id') ?? String(index)
  const authorId = attribute(comment, 'authorId') ?? ''
  const body = children(comment).find((child) => (tagName(child) ?? '').endsWith(':txBody'))

  return {
    id,
    author: authors.get(authorId) ?? { name: 'Someone', initials: '' },
    text: body === undefined ? textOf(named(comment, 'text')[0] ?? comment) : textOf(body),
    created: attribute(comment, 'created') ?? attribute(comment, 'dt') ?? null,
    resolved: attribute(comment, 'status') === 'resolved',
    editable: !modern,
    replies: named(comment, 'reply').map((reply, at) => readOne(reply, at, modern, authors)),
    threaded: modern,
  }
}

function readPart(
  pkg: OoxmlPackage,
  path: string,
  authors: ReadonlyMap<string, CommentAuthor>,
): Comment[] {
  const root = rootOf(getPartText(pkg, path) ?? '')
  if (root === undefined) return []

  const modern = (tagName(root) ?? '').startsWith('p188:')

  // Only the remarks at the top of the part: a reply is inside the one it
  // answers, and reading it twice would show the conversation twice.
  return children(root)
    .filter((child) => (tagName(child) ?? '').replace(/^[^:]*:/u, '') === 'cm')
    .map((comment, index) => readOne(comment, index, modern, authors))
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

  const relationships = parseRelationships(getPartText(pkg, presentationRelsPart(pkg)) ?? '')
  const named_ = [...relationships.values()].some(
    (one) => one.type === COMMENT_AUTHORS_RELATIONSHIP,
  )
  if (!named_) {
    addRelationship(relationships, COMMENT_AUTHORS_RELATIONSHIP, 'commentAuthors.xml')
    setPartText(pkg, presentationRelsPart(pkg), serializeRelationships(relationships))
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

/** The `p188:cm` with a given id, in whichever part of the slide holds it. */
function findThread(
  pkg: OoxmlPackage,
  slide: Slide,
  id: string,
): { path: string; roots: XmlNode[]; comment: XmlNode } | null {
  for (const path of partsOf(pkg, slide)) {
    const roots = parseXml(getPartText(pkg, path) ?? '')
    const root = roots.find((node) => !(tagName(node) ?? '?').startsWith('?'))
    if (root === undefined || !(tagName(root) ?? '').startsWith('p188:')) continue

    const comment = children(root).find(
      (child) => tagName(child) === 'p188:cm' && attribute(child, 'id') === id,
    )
    if (comment !== undefined) return { path, roots, comment }
  }

  return null
}

/** A GUID in the braces the format writes them in. */
const guid = (): string => `{${crypto.randomUUID().toUpperCase()}}`

/**
 * Makes sure the newer authors part names the person, and answers their id.
 *
 * Written beside the authors already there and shaped like them. The part is
 * not made where there is none: a thread only exists because PowerPoint wrote
 * one, and PowerPoint wrote the authors with it.
 */
function modernAuthorId(pkg: OoxmlPackage, author: CommentAuthor): string | null {
  const map = readPresentation(pkg)

  for (const path of map.commentAuthors) {
    const roots = parseXml(getPartText(pkg, path) ?? '')
    const root = roots.find((node) => (tagName(node) ?? '').startsWith('p188:'))
    if (root === undefined) continue

    const existing = children(root).find((one) => attribute(one, 'name') === author.name)
    const found = existing === undefined ? undefined : attribute(existing, 'id')
    if (found !== undefined) return found

    const id = guid()
    children(root).push(
      element('p188:author', { id, name: author.name, initials: author.initials }),
    )
    setPartText(pkg, path, withDeclaration(buildXml(roots)))
    return id
  }

  return null
}

/**
 * Answers a thread PowerPoint started.
 *
 * Only a thread: the older format has no replies, so a remark there is
 * answered by making another remark, which is what it already means.
 */
export function replyToComment(
  pkg: OoxmlPackage,
  slide: Slide,
  id: string,
  reply: NewComment,
): boolean {
  if (reply.text.trim() === '') return false

  const found = findThread(pkg, slide, id)
  const author = found === null ? null : modernAuthorId(pkg, reply.author)
  if (found === null || author === null) return false

  const list = ensureChild(found.comment, 'p188:replyLst', [
    'p188:pos',
    'p188:txBody',
    'p188:replyLst',
  ])

  children(list).push(
    element('p188:reply', { id: guid(), authorId: author, created: new Date().toISOString() }, [
      element('p188:txBody', {}, [
        element('a:bodyPr'),
        element('a:p', {}, [element('a:r', {}, [element('a:t', {}, [{ '#text': reply.text }])])]),
      ]),
    ]),
  )

  setPartText(pkg, found.path, withDeclaration(buildXml(found.roots)))
  return true
}

/**
 * Marks a thread as dealt with, or takes the mark off.
 *
 * One attribute, on a comment PowerPoint wrote. `active` rather than removing
 * the attribute: a thread that stated nothing is not the same as one somebody
 * reopened, and PowerPoint writes the word.
 */
export function resolveComment(
  pkg: OoxmlPackage,
  slide: Slide,
  id: string,
  resolved: boolean,
): boolean {
  const found = findThread(pkg, slide, id)
  if (found === null) return false

  const wanted = resolved ? 'resolved' : 'active'
  if (attribute(found.comment, 'status') === wanted) return false

  setAttribute(found.comment, 'status', wanted)
  setPartText(pkg, found.path, withDeclaration(buildXml(found.roots)))
  return true
}
