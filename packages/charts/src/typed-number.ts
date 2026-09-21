/**
 * What somebody typed into a cell, as a number.
 *
 * `Number('1,5')` is `NaN`, and half the world types the comma — so a chart
 * editor that handed the text straight to `Number` would swallow every other
 * European's number without saying anything. The rules here are the ones a
 * spreadsheet uses, written down rather than guessed at each call site:
 *
 * - nothing at all is a gap, which is not the same as a nought;
 * - spaces are grouping and go, including the ones a keyboard never types
 *   (thin, narrow, non-breaking) — `1 234,5` is a number people write;
 * - a comma beside a dot is grouping, and the dot decides: `1,234.5`;
 * - a comma on its own is the decimal point: `1,5`;
 * - anything else is refused, because a cell that quietly becomes something
 *   else is worse than one that refuses to change.
 */

// `\s` in a Unicode regex already covers the thin, narrow and non-breaking
// spaces people paste in with numbers; naming them is what a reader needs.
const SPACES = /\s/gu

export type TypedNumber = number | null | undefined

export function parseTypedNumber(text: string): TypedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const bare = trimmed.replace(SPACES, '')
  const dot = bare.lastIndexOf('.')
  const comma = bare.lastIndexOf(',')

  // Whichever comes last is the decimal point, and the other is grouping.
  const normalised =
    dot === -1 && comma === -1
      ? bare
      : comma > dot
        ? bare.replace(/\./gu, '').replace(',', '.')
        : bare.replace(/,/gu, '')

  const parsed = Number(normalised)
  return Number.isFinite(parsed) ? parsed : undefined
}
