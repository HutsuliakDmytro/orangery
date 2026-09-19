import {
  attribute,
  children,
  findChild,
  getPartText,
  parseXml,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { textOf } from './workbook'

/**
 * The two kinds of comment a workbook can hold.
 *
 * The old kind is a note: one block of text pinned to a cell, with an author
 * and a yellow box drawn by a VML part nobody has enjoyed reading since 2007.
 * The new kind is a thread — a comment with replies, each by a person the
 * workbook lists separately — and Excel writes **both**, the old one as a
 * fallback so older readers show something.
 *
 * Reading both and preferring the thread is what keeps a reply from
 * disappearing; reading only the old one would turn a conversation into
 * whatever its first line happened to be.
 */

export interface Note {
  /** The cell it is pinned to, as written: `B7`. */
  cell: string
  author: string
  text: string
}

export interface Reply {
  /** Who wrote it, resolved through the workbook's list of people. */
  author: string
  text: string
  /** ISO 8601, as Excel writes it. */
  date: string | null
}

export interface Thread {
  cell: string
  /** The first comment and its replies, in the order they were written. */
  comments: Reply[]
  resolved: boolean
}

/** The authors an old-style comment part lists, by position. */
function readAuthors(root: XmlNode): string[] {
  const authors = findChild(root, 'authors')
  if (authors === undefined) return []

  return children(authors)
    .filter((child) => tagName(child) === 'author')
    .map((child) => textOf(child))
}

export function readNotes(xml: string): Note[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'comments')
  if (root === undefined) return []

  const authors = readAuthors(root)
  const list = findChild(root, 'commentList')
  if (list === undefined) return []

  return children(list).flatMap((comment) => {
    if (tagName(comment) !== 'comment') return []

    const cell = attribute(comment, 'ref')
    if (cell === undefined) return []

    const index = Number(attribute(comment, 'authorId'))
    const text = findChild(comment, 'text')

    return [
      {
        cell,
        author: authors[Number.isFinite(index) ? index : 0] ?? '',
        // The text is runs, because a note can be formatted; its words are
        // all of them together.
        text: text === undefined ? '' : textOf(text),
      },
    ]
  })
}

/** The people a threaded comment refers to, by the id it uses. */
export function readPeople(pkg: OoxmlPackage): Map<string, string> {
  const part = [...pkg.parts.keys()].find((path) => /^xl\/persons\/person\d*\.xml$/u.test(path))
  const root =
    part === undefined
      ? undefined
      : parseXml(getPartText(pkg, part) ?? '').find((node) => tagName(node) === 'personList')

  const people = new Map<string, string>()
  if (root === undefined) return people

  for (const person of children(root)) {
    const id = attribute(person, 'id')
    const name = attribute(person, 'displayName')
    if (id !== undefined && name !== undefined) people.set(id, name)
  }

  return people
}

export function readThreads(xml: string, people: ReadonlyMap<string, string>): Thread[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'ThreadedComments')
  if (root === undefined) return []

  const threads = new Map<string, Thread>()

  for (const comment of children(root)) {
    if (tagName(comment) !== 'threadedComment') continue

    const cell = attribute(comment, 'ref')
    if (cell === undefined) continue

    const person = attribute(comment, 'personId') ?? ''
    const text = findChild(comment, 'text')

    const reply: Reply = {
      author: people.get(person) ?? '',
      text: text === undefined ? '' : textOf(text),
      date: attribute(comment, 'dT') ?? null,
    }

    // A reply names the comment it answers; the first one names nothing, and
    // everything on a cell belongs to that cell's thread.
    const thread = threads.get(cell) ?? { cell, comments: [], resolved: false }
    thread.comments.push(reply)
    thread.resolved = thread.resolved || attribute(comment, 'done') === '1'
    threads.set(cell, thread)
  }

  return [...threads.values()]
}

export interface SheetComments {
  /** Threads where the sheet has them, notes where it has only those. */
  threads: Thread[]
  notes: Note[]
}

/**
 * Everything said about the cells of one sheet.
 *
 * A cell with both a thread and a note has them both here: the note is the
 * fallback Excel writes for older readers, and showing it beside the thread
 * would be showing the same words twice — which is the caller's decision, made
 * once it knows what it is drawing.
 */
export function readSheetComments(
  pkg: OoxmlPackage,
  notesPart: string | null,
  threadsPart: string | null,
): SheetComments {
  return {
    threads:
      threadsPart === null ? [] : readThreads(getPartText(pkg, threadsPart) ?? '', readPeople(pkg)),
    notes: notesPart === null ? [] : readNotes(getPartText(pkg, notesPart) ?? ''),
  }
}
