import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readChart } from '@orangery/ooxml-drawingml'
import type { Chart } from '@orangery/ooxml-drawingml'
import { ChartView } from './chart-view'

/**
 * Charts, drawn.
 *
 * The parts are built by hand: a fixture with a scatter, a secondary axis and
 * data labels on it would be a fixture built for these tests anyway, and one
 * written here says what it is for.
 */

const NO_CONTEXT = { scheme: new Map(), map: new Map() }

const cache = (tag: string, values: readonly number[]) =>
  `<c:${tag}><c:numRef><c:numCache><c:ptCount val="${String(values.length)}"/>` +
  values
    .map((value, index) => `<c:pt idx="${String(index)}"><c:v>${String(value)}</c:v></c:pt>`)
    .join('') +
  `</c:numCache></c:numRef></c:${tag}>`

const categories = (names: readonly string[]) =>
  `<c:cat><c:strRef><c:strCache><c:ptCount val="${String(names.length)}"/>` +
  names.map((name, index) => `<c:pt idx="${String(index)}"><c:v>${name}</c:v></c:pt>`).join('') +
  '</c:strCache></c:strRef></c:cat>'

function chartOf(plotArea: string): Chart {
  const chart = readChart(
    `<c:chartSpace xmlns:c="x"><c:chart><c:plotArea>${plotArea}</c:plotArea></c:chart></c:chartSpace>`,
  )
  if (chart === null) throw new Error('the part holds no chart')
  return chart
}

const draw = (chart: Chart) =>
  render(
    <svg>
      <ChartView
        chart={chart}
        x={0}
        y={0}
        width={320}
        height={200}
        theme={undefined}
        context={NO_CONTEXT}
      />
    </svg>,
  )

describe('a scatter', () => {
  const scatter = (style = 'lineMarker') =>
    chartOf(
      `<c:scatterChart><c:scatterStyle val="${style}"/>` +
        `<c:ser>${cache('xVal', [0, 5, 10])}${cache('yVal', [1, 2, 3])}</c:ser>` +
        '</c:scatterChart>',
    )

  it('draws a point for each pair', () => {
    const { container } = draw(scatter())
    expect(container.querySelectorAll('circle')).toHaveLength(3)
  })

  it('places a point by its x rather than at an even step', () => {
    // The first and last span the plot; the middle one sits halfway because
    // five is halfway between nought and ten.
    const circles = [...draw(scatter()).container.querySelectorAll('circle')]
    const xs = circles.map((circle) => Number(circle.getAttribute('cx')))

    expect(xs[1]).toBeCloseTo(((xs[0] ?? 0) + (xs[2] ?? 0)) / 2, 1)
  })

  it('joins the points only when the chart says to', () => {
    expect(draw(scatter()).container.querySelectorAll('path')).not.toHaveLength(0)
    expect(draw(scatter('marker')).container.querySelectorAll('path')).toHaveLength(0)
  })
})

describe('data labels', () => {
  const bars = (labels: string) =>
    chartOf(
      `<c:barChart>${labels}<c:ser>${categories(['Q1', 'Q2'])}${cache('val', [12, 34])}</c:ser></c:barChart>`,
    )

  it('writes the value beside each point when the chart asks', () => {
    const { container } = draw(bars('<c:dLbls><c:showVal val="1"/></c:dLbls>'))
    expect(container.textContent).toContain('12')
    expect(container.textContent).toContain('34')
  })

  it('writes the category name when that is what was asked for', () => {
    const { container } = draw(bars('<c:dLbls><c:showCatName val="1"/></c:dLbls>'))
    expect(container.textContent).toContain('Q1')
  })

  it('writes nothing when the chart asks for nothing', () => {
    // A chart with no labels is not a chart with empty ones.
    const { container } = draw(bars(''))
    expect(container.querySelectorAll('text[text-anchor="middle"]')).toHaveLength(0)
  })

  it('turns a pie’s values into shares', () => {
    const pie = chartOf(
      '<c:pieChart><c:dLbls><c:showPercent val="1"/></c:dLbls>' +
        `<c:ser>${categories(['A', 'B'])}${cache('val', [75, 25])}</c:ser></c:pieChart>`,
    )

    expect(draw(pie).container.textContent).toContain('75%')
  })
})

describe('two groups on two axes', () => {
  const combination = chartOf(
    `<c:barChart><c:axId val="1"/><c:axId val="2"/><c:ser>${categories(['Q1', 'Q2'])}${cache('val', [1000, 2000])}</c:ser></c:barChart>` +
      `<c:lineChart><c:axId val="3"/><c:axId val="4"/><c:ser>${cache('val', [0.1, 0.2])}</c:ser></c:lineChart>`,
  )

  it('draws both groups, not only the first', () => {
    const { container } = draw(combination)

    expect(container.querySelectorAll('rect').length).toBeGreaterThan(1)
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('numbers both sides, each in its own units', () => {
    const { container } = draw(combination)
    const text = container.textContent

    // Thousands on one side, tenths on the other: one scale for both would
    // draw the margin as a flat line along the bottom.
    expect(text).toContain('2000')
    expect(text).toContain('0.2')
  })

  it('draws one set of gridlines, not a mesh', () => {
    const { container } = draw(combination)
    const across = [...container.querySelectorAll('line')].filter(
      (line) => line.getAttribute('x1') !== line.getAttribute('x2'),
    )

    expect(across).toHaveLength(5)
  })

  it('gives the second group its own colours', () => {
    const { container } = draw(combination)
    const line = container.querySelector('path')

    expect(line?.getAttribute('stroke')).not.toBe(
      container.querySelector('rect:not([fill="#FFFFFF"])')?.getAttribute('fill'),
    )
  })
})

describe('a chart nobody here can draw', () => {
  it('is framed and named rather than approximated', () => {
    // A radar chart drawn as bars would be a lie.
    const { container } = draw(chartOf('<c:radarChart><c:ser/></c:radarChart>'))
    expect(container.textContent).toContain('Chart')
  })
})
