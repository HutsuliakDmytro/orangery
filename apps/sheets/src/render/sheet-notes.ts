import { parseReference } from '@orangery/ooxml-spreadsheet'
import type { SheetComments } from '@orangery/ooxml-spreadsheet'

/**
 * What has been said about a cell, ready to be asked about one.
 *
 * A sheet's comments arrive as two lists keyed by `B7`; the grid asks by row
 * and column, on every visible cell of every repaint. Indexed once per sheet
 * so that question is a lookup rather than a search through a list.
 *
 * A cell can have both a thread and a note: Excel writes the note as a
 * fallback for readers older than 2018, and it holds the same words with the
 * author's name glued to the front. Showing both would be showing it twice, so
 * the thread wins where there is one.
 */

export interface CellNote {
  /** Threads are the modern kind, and the two are marked differently. */
  kind: 'thread' | 'note'
  author: string
  /** Every comment of a thread, or the one block of a note. */
  said: { author: string; text: string }[]
  resolved: boolean
}

export interface SheetNotes {
  at: (position: { row: number; column: number }) => CellNote | null
  /** Whether the sheet has anything to say at all, so a caller can skip it. */
  any: boolean
}

/** One number per cell: sixteen thousand columns fit inside fourteen bits. */
const keyOf = (row: number, column: number): number => row * 16_384 + column

export function notesOf(comments: SheetComments): SheetNotes {
  const held = new Map<number, CellNote>()

  for (const note of comments.notes) {
    const position = parseReference(note.cell)
    if (position === null) continue

    held.set(keyOf(position.row, position.column), {
      kind: 'note',
      author: note.author,
      said: [{ author: note.author, text: note.text }],
      resolved: false,
    })
  }

  // After the notes, so a thread replaces the fallback written beside it.
  for (const thread of comments.threads) {
    const position = parseReference(thread.cell)
    if (position === null) continue

    held.set(keyOf(position.row, position.column), {
      kind: 'thread',
      author: thread.comments[0]?.author ?? '',
      said: thread.comments.map((one) => ({ author: one.author, text: one.text })),
      resolved: thread.resolved,
    })
  }

  return {
    at: (position) => held.get(keyOf(position.row, position.column)) ?? null,
    any: held.size > 0,
  }
}
