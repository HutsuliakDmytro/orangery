import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@orangery/platform'
import type { Place } from './formula'

/**
 * Why a cell says what it says.
 *
 * Two questions people ask of a spreadsheet and one it rarely answers. Where
 * did this number come from, and where did this error come from — and the
 * second is the harder one, because an error is contagious: a `#DIV/0!` in one
 * cell turns every sum that touches it into `#DIV/0!` too, and the screen then
 * shows twenty wrong cells with nothing to say which of them is the cause.
 *
 * The engine knows both, because the dependency graph it keeps in order to
 * recalculate is the same knowledge read the other way round. Nothing here
 * works anything out; it asks, and says what the answer means in words.
 */

/** A rectangle on a sheet, which is how a precedent is drawn. */
export interface TraceBox {
  sheet: string
  top: number
  bottom: number
  left: number
  right: number
}

export interface Traced {
  /** What the formula reads. A single cell is a rectangle one cell wide. */
  precedents: TraceBox[]
  /** The formulas that read this cell, directly. */
  dependents: Place[]
  /** Whether it names a column whose end is a fact about the sheet. */
  wholeColumns: boolean
  /** Whether it reaches into a workbook this one does not have. */
  external: boolean
  volatile: boolean
  /** Where the error this cell shows began, when it began somewhere else. */
  blame: Place | null
}

const nothing: Traced = {
  precedents: [],
  dependents: [],
  wholeColumns: false,
  external: false,
  volatile: false,
  blame: null,
}

export async function traceCell(
  book: string,
  sheet: string,
  row: number,
  column: number,
): Promise<Traced> {
  if (!isTauri()) return nothing
  return await invoke<Traced>('formula_trace', { book, sheet, row, column })
}

/**
 * What an error value means, in a sentence somebody can act on.
 *
 * Excel shows the same nine strings and explains them in a menu two clicks
 * away; the sentences here are what those menus say, said shorter. They are
 * deliberately about the cause rather than the name — somebody reading
 * `#VALUE!` already knows it says `#VALUE!`.
 */
export function explanationOf(error: string): string | null {
  return EXPLANATIONS[error.toUpperCase()] ?? null
}

const EXPLANATIONS: Record<string, string> = {
  '#DIV/0!': 'Something was divided by nought, or by a cell with nothing in it.',
  '#VALUE!': 'A formula was given text where it needed a number.',
  '#REF!': 'A formula points at a cell that is no longer there.',
  '#NAME?': 'A name in the formula is one this workbook does not know.',
  '#NUM!': 'A number came out too large, or a calculation could not settle on one.',
  '#N/A': 'A lookup found nothing. Often that is the answer rather than a fault.',
  '#NULL!': 'Two ranges were asked to overlap and they do not.',
  '#SPILL!': 'The answer needs more cells than are free beside it.',
  '#CALC!': 'The calculation cannot be finished — usually an empty array.',
  '#GETTING_DATA': 'A value is still being fetched.',
}

/** Whether a cell's value is one of the errors a spreadsheet has. */
export const isError = (value: string | null): boolean =>
  value !== null && EXPLANATIONS[value.toUpperCase()] !== undefined
