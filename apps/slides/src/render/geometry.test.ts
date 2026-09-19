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

/**
 * Every name `ST_ShapeType` has, all 187 of them.
 *
 * Written out rather than derived from what the table happens to hold: a list
 * taken from the code would pass whatever the code did, and the question this
 * asks is whether a shape somebody can draw in PowerPoint arrives here as
 * itself or as a rectangle.
 */
const EVERY_PRESET = [
  'line',
  'lineInv',
  'triangle',
  'rtTriangle',
  'rect',
  'diamond',
  'parallelogram',
  'trapezoid',
  'nonIsoscelesTrapezoid',
  'pentagon',
  'hexagon',
  'heptagon',
  'octagon',
  'decagon',
  'dodecagon',
  'star4',
  'star5',
  'star6',
  'star7',
  'star8',
  'star10',
  'star12',
  'star16',
  'star24',
  'star32',
  'roundRect',
  'round1Rect',
  'round2SameRect',
  'round2DiagRect',
  'snipRoundRect',
  'snip1Rect',
  'snip2SameRect',
  'snip2DiagRect',
  'plaque',
  'ellipse',
  'teardrop',
  'homePlate',
  'chevron',
  'pieWedge',
  'pie',
  'blockArc',
  'donut',
  'noSmoking',
  'rightArrow',
  'leftArrow',
  'upArrow',
  'downArrow',
  'stripedRightArrow',
  'notchedRightArrow',
  'bentUpArrow',
  'leftRightArrow',
  'upDownArrow',
  'leftUpArrow',
  'leftRightUpArrow',
  'quadArrow',
  'leftArrowCallout',
  'rightArrowCallout',
  'upArrowCallout',
  'downArrowCallout',
  'leftRightArrowCallout',
  'upDownArrowCallout',
  'quadArrowCallout',
  'bentArrow',
  'uturnArrow',
  'circularArrow',
  'leftCircularArrow',
  'leftRightCircularArrow',
  'curvedRightArrow',
  'curvedLeftArrow',
  'curvedUpArrow',
  'curvedDownArrow',
  'swooshArrow',
  'cube',
  'can',
  'lightningBolt',
  'heart',
  'sun',
  'moon',
  'smileyFace',
  'irregularSeal1',
  'irregularSeal2',
  'foldedCorner',
  'bevel',
  'frame',
  'halfFrame',
  'corner',
  'diagStripe',
  'chord',
  'arc',
  'leftBracket',
  'rightBracket',
  'leftBrace',
  'rightBrace',
  'bracketPair',
  'bracePair',
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
  'callout1',
  'callout2',
  'callout3',
  'accentCallout1',
  'accentCallout2',
  'accentCallout3',
  'borderCallout1',
  'borderCallout2',
  'borderCallout3',
  'accentBorderCallout1',
  'accentBorderCallout2',
  'accentBorderCallout3',
  'wedgeRectCallout',
  'wedgeRoundRectCallout',
  'wedgeEllipseCallout',
  'cloudCallout',
  'cloud',
  'ribbon',
  'ribbon2',
  'ellipseRibbon',
  'ellipseRibbon2',
  'leftRightRibbon',
  'verticalScroll',
  'horizontalScroll',
  'wave',
  'doubleWave',
  'plus',
  'flowChartProcess',
  'flowChartDecision',
  'flowChartInputOutput',
  'flowChartPredefinedProcess',
  'flowChartInternalStorage',
  'flowChartDocument',
  'flowChartMultidocument',
  'flowChartTerminator',
  'flowChartPreparation',
  'flowChartManualInput',
  'flowChartManualOperation',
  'flowChartConnector',
  'flowChartPunchedCard',
  'flowChartPunchedTape',
  'flowChartSummingJunction',
  'flowChartOr',
  'flowChartCollate',
  'flowChartSort',
  'flowChartExtract',
  'flowChartMerge',
  'flowChartOfflineStorage',
  'flowChartOnlineStorage',
  'flowChartMagneticTape',
  'flowChartMagneticDisk',
  'flowChartMagneticDrum',
  'flowChartDisplay',
  'flowChartDelay',
  'flowChartAlternateProcess',
  'flowChartOffpageConnector',
  'actionButtonBlank',
  'actionButtonHome',
  'actionButtonHelp',
  'actionButtonInformation',
  'actionButtonForwardNext',
  'actionButtonBackPrevious',
  'actionButtonEnd',
  'actionButtonBeginning',
  'actionButtonReturn',
  'actionButtonDocument',
  'actionButtonSound',
  'actionButtonMovie',
  'gear6',
  'gear9',
  'funnel',
  'mathPlus',
  'mathMinus',
  'mathMultiply',
  'mathDivide',
  'mathEqual',
  'mathNotEqual',
  'cornerTabs',
  'squareTabs',
  'plaqueTabs',
  'chartX',
  'chartStar',
  'chartPlus',
]

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
    expect(PRESET_NAMES.length).toBe(EVERY_PRESET.length)
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

describe('every shape the format has a name for', () => {
  it('is drawn as itself', () => {
    const missing = EVERY_PRESET.filter((preset) => !isKnownPreset(preset))
    expect(missing).toEqual([])
  })

  it('is the whole of what this app knows, and nothing invented', () => {
    // A name here that the format does not have would be a shape no file can
    // ask for, kept alive by nothing but this table.
    expect(PRESET_NAMES.filter((preset) => !EVERY_PRESET.includes(preset))).toEqual([])
  })
})

describe('a preset nobody here knows', () => {
  it('falls back to the box it occupies', () => {
    // Nothing in the format is called this. A file from something newer than
    // this app is the case: in the right place at the right size with the right
    // fill, which is close enough to read a slide by — and it is never written
    // back.
    expect(isKnownPreset('quantumRhombus')).toBe(false)
    expect(pathFor('quantumRhombus', BOX)).toBe(pathFor('rect', BOX))
  })
})

describe('the handles a shape states', () => {
  const handles = (values: Record<string, number>) =>
    new Map(Object.entries(values).map(([name, value]) => [name, `val ${String(value)}`]))

  /** The numbers a path is made of, for comparing one drawing with another. */
  const of = (preset: string, values?: Record<string, number>) =>
    pathFor(preset, BOX, values === undefined ? undefined : handles(values))

  /** The radii of every arc in a path, which is what a corner handle sets. */
  const radiiIn = (path: string) =>
    [...path.matchAll(/A(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/gu)].map(
      (match) => [Number(match[1]), Number(match[2])] as const,
    )

  it('rounds a corner as far as it is dragged', () => {
    // Dragged to nothing is a plain rectangle; dragged to the end is a stadium.
    for (const [rx] of radiiIn(of('roundRect', { adj: 0 }))) expect(rx).toBe(0)
    for (const [rx] of radiiIn(of('roundRect', { adj: 50000 }))) {
      expect(rx).toBeCloseTo(BOX.height / 2, 0)
    }
    expect(of('roundRect')).not.toBe(of('roundRect', { adj: 0 }))
  })

  it('measures the corner against the shorter side, not each side', () => {
    // Otherwise a stretched rectangle would have oval corners.
    const radii = radiiIn(
      pathFor('roundRect', { width: 800, height: 200 }, handles({ adj: 25000 })),
    )

    expect(radii).not.toHaveLength(0)
    for (const [rx, ry] of radii) expect(rx).toBe(ry)
  })

  it('gives each corner of a two-cornered preset its own handle', () => {
    const same = of('round2DiagRect', { adj1: 10000, adj2: 10000 })
    const different = of('round2DiagRect', { adj1: 10000, adj2: 40000 })

    expect(same).not.toBe(different)
  })

  it('keeps a corner from eating more than the side it is on', () => {
    // Past half, the two corners of a side would cross and the path would fold
    // over itself.
    for (const [rx] of radiiIn(of('roundRect', { adj: 500000 }))) {
      expect(rx).toBeLessThanOrEqual(Math.min(BOX.width, BOX.height) / 2)
    }
  })

  it('shortens an arrow’s head as the arrow gets wider', () => {
    const square = numbersIn(pathFor('rightArrow', { width: 300, height: 300 }))
    const wide = numbersIn(pathFor('rightArrow', { width: 900, height: 300 }))

    // The head is a piece of the arrow, not a share of the slide: at three
    // times the width it is the same length and therefore a third as much of it.
    expect(square[2]).toBeCloseTo(150, 0)
    expect(wide[2]).toBeCloseTo(750, 0)
  })

  it('thickens an arrow’s tail when the handle says so', () => {
    const thin = numbersIn(pathFor('rightArrow', BOX, handles({ adj1: 20000 })))
    const thick = numbersIn(pathFor('rightArrow', BOX, handles({ adj1: 80000 })))

    expect(thin[1]).toBeGreaterThan(thick[1] ?? 0)
  })

  it('leaves a shape alone when the file states nothing', () => {
    // A deck nobody has reshaped must look exactly as it did before any of this.
    for (const preset of PRESET_NAMES) {
      expect(pathFor(preset, BOX, new Map()), preset).toBe(pathFor(preset, BOX))
    }
  })

  it('ignores a formula it cannot read rather than drawing nothing', () => {
    // `a:gd` can hold arithmetic; the ones in `a:avLst` are a literal value,
    // and anything else falls back to the default rather than to NaN.
    const odd = pathFor('roundRect', BOX, new Map([['adj', '*/ 100 w 200']]))
    expect(odd).toBe(pathFor('roundRect', BOX))
  })
})
