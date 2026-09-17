import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Numbering headings — 1., 1.1., 1.1.1. — computed from the document.
 *
 * Computed rather than typed, and computed in one place: the number shown
 * beside a heading and the number written into the table of contents are the
 * same string, so the two can never disagree. Word does this by attaching a
 * numbering definition to the heading styles; the same definition is what gets
 * written to the file, and this is what draws it on screen.
 */

export type HeadingNumberScheme = 'decimal' | 'outline'

export const HEADING_NUMBER_SCHEMES: readonly HeadingNumberScheme[] = ['decimal', 'outline']

/** The deepest heading level Word's built-in styles go to. */
const LEVELS = 9

export interface HeadingNumber {
  /** Document position of the heading node. */
  position: number
  level: number
  /** What is drawn in front of the heading, e.g. `1.2.3.` */
  label: string
}

const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

export function toRoman(value: number): string {
  if (value <= 0) return ''

  let remaining = value
  let result = ''
  for (const [amount, numeral] of ROMAN) {
    while (remaining >= amount) {
      result += numeral
      remaining -= amount
    }
  }
  return result
}

/** Spreadsheet-style letters, so the twenty-seventh item is `aa` rather than a gap. */
export function toAlpha(value: number): string {
  if (value <= 0) return ''

  let remaining = value
  let result = ''
  while (remaining > 0) {
    const index = (remaining - 1) % 26
    result = String.fromCharCode(97 + index) + result
    remaining = Math.floor((remaining - 1) / 26)
  }
  return result
}

/**
 * The marker one level of the outline scheme uses.
 *
 * Word's outline gallery: roman, capitals, digits, lowercase letters, lowercase
 * roman — then it starts over, which is what a document nine levels deep needs.
 */
function outlineMarker(level: number, count: number): string {
  switch ((level - 1) % 5) {
    case 0:
      return `${toRoman(count)}.`
    case 1:
      return `${toAlpha(count).toUpperCase()}.`
    case 2:
      return `${String(count)}.`
    case 3:
      return `${toAlpha(count)})`
    default:
      return `${toRoman(count).toLowerCase()})`
  }
}

function label(scheme: HeadingNumberScheme, counters: readonly number[], level: number): string {
  if (scheme === 'outline') return outlineMarker(level, counters[level - 1] ?? 0)

  // A legal-style number carries every level above it, which is what makes it
  // readable out of context — "1.2.3." says where it sits, "3." does not.
  return `${counters
    .slice(0, level)
    .map((count) => String(count))
    .join('.')}.`
}

/**
 * Numbers every heading in the document.
 *
 * A level that appears without the ones above it still counts: a document whose
 * first heading is a Heading 2 numbers it `0.1.` in Word, and leaving the gap
 * visible is more honest than quietly promoting it.
 */
export function headingNumbers(doc: ProseMirrorNode, scheme: HeadingNumberScheme): HeadingNumber[] {
  const counters = new Array<number>(LEVELS).fill(0)
  const numbers: HeadingNumber[] = []

  doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return true

    const raw: unknown = node.attrs['level']
    const level = Math.min(LEVELS, Math.max(1, typeof raw === 'number' ? raw : 1))

    counters[level - 1] = (counters[level - 1] ?? 0) + 1
    // Everything below this heading starts again underneath it.
    for (let deeper = level; deeper < LEVELS; deeper += 1) counters[deeper] = 0

    numbers.push({ position, level, label: label(scheme, counters, level) })
    return false
  })

  return numbers
}
