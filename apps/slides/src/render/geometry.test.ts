import { describe, expect, it } from 'vitest'
import { isKnownPreset, isLinePreset, pathFor, PRESET_NAMES } from './geometry'

/**
 * The preset paths, checked as paths.
 *
 * A typo in one of these does not throw: SVG drops a command it cannot read and
 * the shape simply does not appear, on somebody else's screen, in a deck nobody
 * here opened. So every path is parsed back and measured.
 */

const BOX = { width: 400, height: 300 }

/** Every number in a path, whatever command it belongs to. */
const numbersIn = (path: string): number[] =>
  [...path.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) => Number(match[0]))

/**
 * The numbers in a path that are lengths, leaving out the ones that are not.
 *
 * An arc states seven values and only four of them are measurements: the other
 * three say which way round it goes. A check that expected all seven to double
 * with the box would be measuring the flags.
 */
function lengthsIn(path: string): number[] {
  const lengths: number[] = []

  for (const [, letter, rest] of path.matchAll(/([A-Za-z])([^A-Za-z]*)/gu)) {
    const values = [...(rest ?? '').matchAll(/-?\d+(?:\.\d+)?/gu)].map((one) => Number(one[0]))

    if (letter?.toUpperCase() !== 'A') {
      lengths.push(...values)
      continue
    }

    for (let at = 0; at + 6 < values.length + 1; at += 7) {
      lengths.push(values[at] ?? 0, values[at + 1] ?? 0, values[at + 5] ?? 0, values[at + 6] ?? 0)
    }
  }

  return lengths
}

describe('every preset', () => {
  it('draws something', () => {
    expect(PRESET_NAMES.length).toBeGreaterThan(120)
  })

  it('starts by moving somewhere', () => {
    for (const preset of PRESET_NAMES) {
      expect(pathFor(preset, BOX).startsWith('M'), preset).toBe(true)
    }
  })

  it('states no number that is not one', () => {
    for (const preset of PRESET_NAMES) {
      const path = pathFor(preset, BOX)
      // `NaN` in a path is what a missing box dimension looks like by the time
      // it reaches the screen, and the browser says nothing about it.
      expect(path, preset).not.toContain('NaN')
      expect(path, preset).not.toContain('undefined')
      expect(path, preset).not.toContain('Infinity')
    }
  })

  it('uses only commands SVG has', () => {
    for (const preset of PRESET_NAMES) {
      const letters = new Set(
        pathFor(preset, BOX)
          .replace(/[^A-Za-z]/gu, '')
          .split(''),
      )
      for (const letter of letters) {
        expect('MLHVCSQTAZ'.includes(letter.toUpperCase()), `${preset}: ${letter}`).toBe(true)
      }
    }
  })

  it('stays near the box it was given', () => {
    for (const preset of PRESET_NAMES) {
      for (const value of numbersIn(pathFor(preset, BOX))) {
        // Loose on purpose: a curve's control points may sit outside the shape,
        // and a coordinate ten times the box is a typo rather than a flourish.
        expect(Math.abs(value), preset).toBeLessThan(BOX.width * 2)
      }
    }
  })

  it('grows with the box rather than holding a size of its own', () => {
    for (const preset of PRESET_NAMES) {
      const small = lengthsIn(pathFor(preset, { width: 100, height: 100 }))
      const large = lengthsIn(pathFor(preset, { width: 200, height: 200 }))

      expect(small.length, preset).toBe(large.length)
      small.forEach((value, index) => {
        // Every coordinate doubles; a constant that did not would be a shape
        // that looks right at one size and wrong at every other.
        expect(large[index] ?? 0, `${preset} at ${String(index)}`).toBeCloseTo(value * 2, 1)
      })
    }
  })
})

describe('a closed shape', () => {
  it('closes, so it can be filled', () => {
    for (const preset of PRESET_NAMES) {
      if (isLinePreset(preset)) continue
      expect(pathFor(preset, BOX), preset).toContain('Z')
    }
  })

  it('is not what a bracket or a connector is', () => {
    // A line has no inside; filling one paints a triangle between its ends.
    for (const preset of ['arc', 'bracketPair', 'leftBrace', 'bentConnector3', 'line']) {
      expect(isLinePreset(preset), preset).toBe(true)
    }
    for (const preset of ['rect', 'star5', 'cloud', 'flowChartDelay']) {
      expect(isLinePreset(preset), preset).toBe(false)
    }
  })
})

describe('a preset nobody here knows', () => {
  it('falls back to the box it occupies', () => {
    // In the right place at the right size with the right fill, which is close
    // enough to read a slide by — and it is never written back.
    expect(isKnownPreset('swooshArrow')).toBe(false)
    expect(pathFor('swooshArrow', BOX)).toBe(pathFor('rect', BOX))
  })
})
