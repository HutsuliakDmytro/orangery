import { CUSTOM_LISTS } from './sort'

/**
 * What comes after what.
 *
 * The fill handle is the one gesture in a spreadsheet that guesses, and the
 * guess has to be the obvious one or it is worse than no guess at all:
 * 1, 2 goes on 3, 4; Monday goes on Tuesday; Q1 goes on Q2; and a single
 * value that means nothing in particular is copied, because repeating is the
 * only safe answer to "I cannot tell what you meant".
 *
 * Everything here works on the text of cells rather than on their values. A
 * date in a spreadsheet is a number with a format on it, and a series of them
 * is a series of numbers; the formatting follows the cell that was dragged,
 * which the caller does and this does not have to know about.
 */

/** A series, as far as the values given can say what it is. */
export type Series =
  | { kind: 'numbers'; from: number; step: number }
  | { kind: 'list'; values: readonly string[]; at: number; step: number }
  | { kind: 'counted'; before: string; after: string; from: number; step: number }
  | { kind: 'copy' }

const NUMBER = /^[-+]?\d*\.?\d+$/u

/** A value ending in a number, which is how `Item 1` and `Q1` are written. */
const COUNTED = /^(.*?)(\d+)(\D*)$/u

/**
 * Where a value sits in a list, matched on the front of the word.
 *
 * `Mon` and `Monday` are the same day, and a column holding both is a column
 * somebody typed by hand.
 */
function placeIn(values: readonly string[], text: string): number {
  const looked = text.trim().toLocaleUpperCase()
  if (looked === '') return -1

  return values.findIndex((one) => {
    const name = one.toLocaleUpperCase()
    return name.startsWith(looked) || looked.startsWith(name)
  })
}

/** Whether the steps between the places are all the same, and what it is. */
function evenStep(places: readonly number[], length: number | null): number | null {
  if (places.length < 2) return null

  const steps = places.slice(1).map((place, index) => {
    const before = places[index] ?? 0
    const step = place - before
    // A list wraps: December to January is a step of one, not of eleven back.
    return length !== null && step < 0 ? step + length : step
  })

  const first = steps[0] ?? 0
  return steps.every((step) => step === first) ? first : null
}

/**
 * What the values that were dragged appear to be.
 *
 * A single value is not a series — one number says nothing about the step —
 * except where it is a name from a list or has a number on the end of it,
 * which are the two cases where the next one is not in doubt.
 */
export function seriesOf(values: readonly string[]): Series {
  const given = values.filter((value) => value !== '')
  if (given.length === 0) return { kind: 'copy' }

  if (given.every((value) => NUMBER.test(value.trim()))) {
    const numbers = given.map((value) => Number(value))
    const first = numbers[0] ?? 0

    if (numbers.length === 1) return { kind: 'numbers', from: first, step: 1 }

    const step = evenStep(numbers, null)
    return step === null ? { kind: 'copy' } : { kind: 'numbers', from: first, step }
  }

  for (const list of CUSTOM_LISTS) {
    const places = given.map((value) => placeIn(list.values, value))
    if (places.some((place) => place < 0)) continue

    const at = places[0] ?? 0
    if (places.length === 1) return { kind: 'list', values: list.values, at, step: 1 }

    const step = evenStep(places, list.values.length)
    if (step !== null) return { kind: 'list', values: list.values, at, step }
  }

  const counted = given.map((value) => COUNTED.exec(value))
  if (counted.every((one) => one !== null)) {
    const parts = counted.map((one) => ({
      before: one[1] ?? '',
      number: Number(one[2] ?? 0),
      after: one[3] ?? '',
    }))

    const first = parts[0]
    const same =
      first !== undefined &&
      parts.every((one) => one.before === first.before && one.after === first.after)

    if (same) {
      const step =
        parts.length === 1
          ? 1
          : evenStep(
              parts.map((one) => one.number),
              null,
            )
      if (step !== null) {
        return {
          kind: 'counted',
          before: first.before,
          after: first.after,
          from: first.number,
          step,
        }
      }
    }
  }

  return { kind: 'copy' }
}

/**
 * The values a drag should write, in order.
 *
 * `at` counts from the first of the values that were dragged, so the first
 * filled cell is at the length of them: the series goes on from where it was
 * rather than starting again.
 */
export function filledWith(
  series: Series,
  source: readonly string[],
  count: number,
  backwards = false,
): string[] {
  const length = source.length
  const way = backwards ? -1 : 1

  return Array.from({ length: count }, (_, index) => {
    const step = (index + 1) * way

    if (series.kind === 'numbers') {
      return String(series.from + (backwards ? step : length - 1 + step) * series.step)
    }

    if (series.kind === 'counted') {
      const number = series.from + (backwards ? step : length - 1 + step) * series.step
      return `${series.before}${String(Math.max(number, 0))}${series.after}`
    }

    if (series.kind === 'list') {
      const size = series.values.length
      const at = series.at + (backwards ? step : length - 1 + step) * series.step
      // Wrapped rather than stopped: a week dragged for a fortnight is two
      // weeks, which is what people expect and what Excel does.
      return series.values[((at % size) + size) % size] ?? ''
    }

    // Copied, and in the order the cells were in: dragging three cells down
    // repeats the three, not the last of them.
    const from = backwards ? length - 1 - (step * -1 - 1) : index
    return source[((from % length) + length) % length] ?? ''
  })
}
