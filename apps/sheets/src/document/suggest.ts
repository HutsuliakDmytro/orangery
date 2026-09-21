import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@orangery/platform'

/**
 * What to offer somebody halfway through typing a formula.
 *
 * Two questions, and the second is the one that matters. Which function are
 * they reaching for — answered by the word under the caret — and, once they
 * have chosen one, how many arguments does it want? A list of names is a
 * lookup table; a list of names with their shapes is the difference between
 * remembering `VLOOKUP` and remembering what its four arguments are in.
 *
 * The list comes from the engine rather than from here. A list written out
 * in the interface is a list that says `XLOOKUP` exists on the day it stops
 * existing.
 */

export interface KnownFunction {
  name: string
  least: number
  /** Null for the ones that take as many as they are given, like `SUM`. */
  most: number | null
  volatile: boolean
}

/** What the caret is in the middle of, and what could finish it. */
export interface Suggestion {
  /** The partial name under the caret, upper-cased as a formula writes one. */
  word: string
  /** Where it starts, so that choosing one knows what to replace. */
  from: number
  matches: KnownFunction[]
}

let known: KnownFunction[] | null = null

/** Every function the engine has, asked for once and kept. */
export async function knownFunctions(): Promise<KnownFunction[]> {
  if (known !== null) return known
  if (!isTauri()) return []

  known = await invoke<KnownFunction[]>('formula_functions')
  return known
}

/** For a window that has already asked, and is drawing a frame. */
export const functionsKnownSoFar = (): KnownFunction[] => known ?? []

/**
 * The word being typed at the caret, if it could still become a function.
 *
 * Only inside a formula: `Northampton` typed into a cell is a place, not a
 * half-written `NOW`. And only where a name could go — after an operator, a
 * bracket or a comma — so that the column of a reference is left alone.
 */
export function suggest(
  text: string,
  caret: number,
  functions: readonly KnownFunction[],
): Suggestion | null {
  if (!text.startsWith('=')) return null

  let from = caret
  while (from > 0 && isNameLetter(text[from - 1] ?? '')) from -= 1

  // A name cannot begin with a digit, and a word that does is the row half
  // of a reference somebody is typing.
  const word = text.slice(from, caret)
  if (word === '' || /^\d/u.test(word)) return null
  if (from === 0) return null

  // Directly after a letter or digit that is not part of the word — which
  // happens in `A1SUM` — there is no name beginning here.
  const before = text[from - 1] ?? ''
  if (isNameLetter(before)) return null

  const upper = word.toUpperCase()
  const matches = functions
    .filter((one) => one.name.startsWith(upper))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8)

  return matches.length === 0 ? null : { word: upper, from, matches }
}

/**
 * The formula with a chosen function put in, and where the caret should go.
 *
 * The opening bracket comes with it, because nobody has ever wanted the name
 * without one, and the caret lands inside it where the first argument goes.
 */
export function chosen(
  text: string,
  suggestion: Suggestion,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(suggestion.from + suggestion.word.length)
  // Not a second bracket if the formula already has one there: somebody
  // editing `=SU(` into `=SUM(` is finishing a formula, not starting one.
  const opened = after.startsWith('(') ? '' : '('
  const made = `${text.slice(0, suggestion.from)}${name}${opened}${after}`

  return { text: made, caret: suggestion.from + name.length + opened.length }
}

/**
 * How many arguments a function wants, in words.
 *
 * Not their names: the engine's registry does not carry them, and inventing
 * them here would be a second list to keep in step — a hint that says
 * `VLOOKUP(lookup_value, …)` and is wrong about it is worse than one that
 * says how many there are and is right.
 */
export function shape(one: KnownFunction): string {
  if (one.most === null) {
    return one.least === 0 ? 'any arguments' : `${String(one.least)} or more arguments`
  }
  if (one.most === 0) return 'no arguments'
  if (one.least === one.most) {
    return one.most === 1 ? '1 argument' : `${String(one.most)} arguments`
  }

  return `${String(one.least)} to ${String(one.most)} arguments`
}

/** What a name is made of, which is what a half-typed one is made of too. */
const isNameLetter = (letter: string): boolean => /[A-Za-z0-9_.]/u.test(letter)
