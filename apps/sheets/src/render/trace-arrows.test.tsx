import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TraceArrows } from './trace-arrows'
import type { Traced } from '../document/trace'

/**
 * The arrows that say where a number came from.
 *
 * What is worth testing is not where the lines land but what is left out: a
 * precedent on another sheet would be an arrow pointing at somewhere on
 * screen that is not where the cell is, which is worse than no arrow at all.
 */

const metrics = { rowHeight: 20, columnWidth: 64, headerWidth: 40, headerHeight: 20 }

const nothing: Traced = {
  precedents: [],
  dependents: [],
  wholeColumns: false,
  external: false,
  volatile: false,
  blame: null,
}

const arrows = (traced: Partial<Traced>) =>
  render(
    <TraceArrows
      traced={{ ...nothing, ...traced }}
      cell={{ row: 5, column: 5 }}
      sheet="Budget"
      metrics={metrics}
      scrollX={0}
      scrollY={0}
    />,
  ).container

describe('drawing a trace', () => {
  it('boxes each precedent and points an arrow at the cell', () => {
    const container = arrows({
      precedents: [{ sheet: 'Budget', top: 0, bottom: 3, left: 0, right: 0 }],
    })

    expect(container.querySelectorAll('rect')).toHaveLength(1)
    expect(container.querySelectorAll('line')).toHaveLength(1)
  })

  it('draws a line out to each dependent', () => {
    const container = arrows({
      dependents: [
        { sheet: 'Budget', row: 9, column: 1 },
        { sheet: 'Budget', row: 9, column: 2 },
      ],
    })

    expect(container.querySelectorAll('line')).toHaveLength(2)
  })

  it('leaves out what is on another sheet', () => {
    const container = arrows({
      precedents: [{ sheet: 'Notes', top: 0, bottom: 0, left: 0, right: 0 }],
      dependents: [{ sheet: 'Notes', row: 1, column: 1 }],
      blame: { sheet: 'Notes', row: 2, column: 2 },
    })

    expect(container.querySelectorAll('line')).toHaveLength(0)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
  })

  it('draws the error trail as well as the ordinary arrows', () => {
    const container = arrows({
      precedents: [{ sheet: 'Budget', top: 0, bottom: 0, left: 0, right: 0 }],
      blame: { sheet: 'Budget', row: 2, column: 2 },
    })

    // One from the precedent, one from where the error began.
    expect(container.querySelectorAll('line')).toHaveLength(2)
  })

  it('draws nothing at all for a cell that reads nothing', () => {
    expect(arrows({}).querySelectorAll('line, rect')).toHaveLength(0)
  })
})
