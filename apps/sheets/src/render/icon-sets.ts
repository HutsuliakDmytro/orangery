import type { CellIcon } from '@orangery/grid'

/**
 * Excel's icon sets, as shapes the grid can draw.
 *
 * The file names a set and a place in it — `4Rating`, third of four — and the
 * grid knows nothing of either. This is where one becomes the other, and it
 * lives in the app rather than in the grid on purpose: an icon set is a fact
 * about SpreadsheetML, and the grid is meant to outlive it.
 *
 * The colours are Excel's as far as the eye can tell and not as far as a
 * pixel can. Nothing in the repository was written by Excel yet, so these are
 * read off the product rather than out of a file; the render diff against real
 * workbooks is what will settle them (`PLAN.md`, phase 1.1).
 */

const RED = '#F8696B'
const AMBER = '#FFC000'
const GREEN = '#63BE7B'
const GREY = '#A5A5A5'
const BLACK = '#4D4D4D'
const PINK = '#FF9999'

/** A ramp from bad to good, in as many steps as the set has. */
const RAMP: Record<number, string[]> = {
  3: [RED, AMBER, GREEN],
  4: [RED, AMBER, '#A9D08E', GREEN],
  5: [RED, '#F4A460', AMBER, '#A9D08E', GREEN],
}

const ARROWS: NonNullable<CellIcon['direction']>[][] = [
  [],
  ['right'],
  ['down', 'up'],
  ['down', 'right', 'up'],
  ['down', 'downRight', 'upRight', 'up'],
  ['down', 'downRight', 'right', 'upRight', 'up'],
]

const colorOf = (count: number, index: number, grey: boolean): string => {
  if (grey) return GREY
  return RAMP[count]?.[index] ?? RAMP[3]?.[Math.min(index, 2)] ?? GREY
}

/**
 * The shape and colour for one icon of a set.
 *
 * An unknown set is drawn as traffic lights rather than not drawn at all: the
 * rule is in the file and a cell with nothing where an icon belongs looks like
 * a cell with no rule on it, which is the one thing it is not. There are two
 * dozen sets and Excel adds to them.
 */
export function iconOf(set: string, index: number, count: number): CellIcon {
  const place = Math.max(0, Math.min(count - 1, index))
  const grey = set.endsWith('Gray')

  switch (set) {
    case '3Arrows':
    case '3ArrowsGray':
    case '4Arrows':
    case '4ArrowsGray':
    case '5Arrows':
    case '5ArrowsGray':
      return {
        shape: 'arrow',
        color: colorOf(count, place, grey),
        direction: ARROWS[count]?.[place] ?? 'right',
      }

    case '3Flags':
      return { shape: 'flag', color: colorOf(count, place, false) }

    case '3Signs':
      // A shape each, so the three are told apart on a black-and-white print
      // and by somebody who cannot tell red from green.
      return {
        shape: place === 0 ? 'diamond' : place === 1 ? 'triangle' : 'circle',
        color: colorOf(3, place, false),
        direction: 'up',
      }

    case '3Symbols':
    case '3Symbols2':
      return {
        shape: place === 0 ? 'cross' : place === 1 ? 'exclamation' : 'check',
        color: colorOf(3, place, false),
      }

    case '3Triangles':
      return place === 1
        ? { shape: 'dash', color: AMBER }
        : {
            shape: 'triangle',
            color: colorOf(3, place, false),
            direction: place === 0 ? 'down' : 'up',
          }

    case '4RedToBlack':
      // The one set whose order is not bad-to-good but red-to-black; the
      // colours are the whole content of it.
      return { shape: 'circle', color: [RED, PINK, GREY, BLACK][place] ?? GREY }

    case '3Stars':
      return { shape: 'star', color: AMBER, filled: place, steps: count - 1 }

    case '4Rating':
    case '5Rating':
      // A rating counts from one: the lowest band still earns a bar, which is
      // what makes it a rating rather than a threshold.
      return { shape: 'bars', color: '#5A5A5A', filled: place + 1, steps: count }

    case '5Quarters':
      return { shape: 'pie', color: BLACK, filled: place, steps: count - 1 }

    case '5Boxes':
      return { shape: 'boxes', color: BLACK, filled: place, steps: count - 1 }

    case '4TrafficLights':
      return { shape: 'circle', color: [BLACK, RED, AMBER, GREEN][place] ?? GREY }

    default:
      return { shape: 'circle', color: colorOf(count, place, grey) }
  }
}
