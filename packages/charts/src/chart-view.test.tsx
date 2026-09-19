import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readChart } from './chart'
import type { Chart } from './chart'
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

/** The chart a part holds, with the check the types cannot make. */
const given = (chart: Chart | null): Chart => {
  if (chart === null) throw new Error('the part holds no chart')
  return chart
}

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
    // A chart with no labels is not a chart with empty ones. The names along
    // the bottom are the axis, not a label, and stay.
    const { container } = draw(bars(''))

    // Point labels are the small text; the axis and the category names are not.
    expect(container.querySelectorAll('text[font-size="8"]')).toHaveLength(0)
    expect(container.textContent).toContain('Q1')
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
    // A waterfall drawn as bars would put wrong numbers on the slide.
    const { container } = draw(chartOf('<c:stockChart><c:ser/></c:stockChart>'))
    expect(container.textContent).toContain('Stock chart')
  })

  it('draws the groups it can when only one of two is beyond it', () => {
    const { container } = draw(
      chartOf(`<c:barChart><c:ser>${cache('val', [1, 2])}</c:ser></c:barChart><c:stockChart/>`),
    )

    expect(container.textContent).not.toContain('Stock chart')
    expect(container.querySelectorAll('rect:not([fill="#FFFFFF"])').length).toBeGreaterThan(0)
  })
})

/** The bars, in the order they were drawn, without the white backing rectangle. */
const barsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('rect:not([fill="#FFFFFF"])')].filter(
    (rect) => Number(rect.getAttribute('height')) > 0,
  )

describe('how bars are laid out', () => {
  const two = (attributes: string) =>
    chartOf(
      `<c:barChart>${attributes}` +
        `<c:ser>${categories(['Q1', 'Q2'])}${cache('val', [10, 20])}</c:ser>` +
        `<c:ser>${cache('val', [5, 15])}</c:ser>` +
        '</c:barChart>',
    )

  it('leaves a gap between categories, as Office does by default', () => {
    // Gap 150 and overlap -27 are the numbers Office writes; with two series
    // the bars take well under half of each category.
    const bars = barsOf(draw(two('')).container)
    const width = Number(bars[0]?.getAttribute('width'))

    // Two categories across 278 points of plot: each slot is 139.
    expect(width).toBeCloseTo(139 / (2 - 1 * -0.27 + 1.5), 1)
  })

  it('makes the bars wider when the chart asks for a smaller gap', () => {
    const wide = Number(
      barsOf(draw(two('<c:gapWidth val="20"/>')).container)[0]?.getAttribute('width'),
    )
    const narrow = Number(
      barsOf(draw(two('<c:gapWidth val="300"/>')).container)[0]?.getAttribute('width'),
    )

    expect(wide).toBeGreaterThan(narrow)
  })

  it('overlaps the bars in a category when the chart says they overlap', () => {
    const apart = barsOf(draw(two('<c:overlap val="0"/>')).container)
    const over = barsOf(draw(two('<c:overlap val="50"/>')).container)

    const distance = (bars: Element[]) =>
      Number(bars[2]?.getAttribute('x')) - Number(bars[0]?.getAttribute('x'))

    // The second series of the first category starts closer to the first.
    expect(distance(over)).toBeLessThan(distance(apart))
  })

  it('piles a stacked group up rather than standing its series side by side', () => {
    const stacked = barsOf(
      draw(
        chartOf(
          '<c:barChart><c:grouping val="stacked"/>' +
            `<c:ser>${categories(['Q1'])}${cache('val', [10])}</c:ser>` +
            `<c:ser>${cache('val', [20])}</c:ser></c:barChart>`,
        ),
      ).container,
    )

    // Same column, one above the other: three series of 40 stack to 120, and a
    // chart that ignored this would draw them off the top.
    expect(stacked[0]?.getAttribute('x')).toBe(stacked[1]?.getAttribute('x'))
    expect(Number(stacked[1]?.getAttribute('y'))).toBeLessThan(
      Number(stacked[0]?.getAttribute('y')),
    )
  })

  it('fills the height of a 100 % chart whatever the numbers are', () => {
    const { container } = draw(
      chartOf(
        '<c:barChart><c:grouping val="percentStacked"/>' +
          `<c:ser>${categories(['Q1'])}${cache('val', [1])}</c:ser>` +
          `<c:ser>${cache('val', [3])}</c:ser></c:barChart>`,
      ),
    )

    const heights = barsOf(container).map((rect) => Number(rect.getAttribute('height')))
    // A quarter and three quarters of the plot, whatever 1 and 3 are.
    expect((heights[1] ?? 0) / (heights[0] ?? 1)).toBeCloseTo(3, 1)
    expect(container.textContent).toContain('100%')
  })
})

describe('colour', () => {
  it('uses the colour a series states for itself over the theme accent', () => {
    const { container } = draw(
      chartOf(
        '<c:barChart><c:ser><c:spPr xmlns:a="a"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>' +
          `${categories(['Q1'])}${cache('val', [1])}</c:ser></c:barChart>`,
      ),
    )

    expect(barsOf(container)[0]?.getAttribute('fill')).toBe('#FF0000')
  })

  it('gives a pie a colour per slice, as a pie is always drawn', () => {
    const { container } = draw(
      chartOf(
        `<c:pieChart><c:ser>${categories(['A', 'B', 'C'])}${cache('val', [1, 1, 1])}</c:ser></c:pieChart>`,
      ),
    )

    const fills = [...container.querySelectorAll('path')].map((path) => path.getAttribute('fill'))
    expect(new Set(fills).size).toBe(3)
  })

  it('lets a point state a colour apart from its series', () => {
    const { container } = draw(
      chartOf(
        '<c:pieChart><c:ser>' +
          '<c:dPt><c:idx val="1"/><c:spPr xmlns:a="a"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></c:spPr></c:dPt>' +
          `${categories(['A', 'B'])}${cache('val', [1, 1])}</c:ser></c:pieChart>`,
      ),
    )

    const fills = [...container.querySelectorAll('path')].map((path) => path.getAttribute('fill'))
    expect(fills[1]).toBe('#00FF00')
  })

  it('colours each bar apart when the chart asks it to vary them', () => {
    const { container } = draw(
      chartOf(
        `<c:barChart><c:varyColors val="1"/><c:ser>${categories(['A', 'B'])}${cache('val', [1, 2])}</c:ser></c:barChart>`,
      ),
    )

    const fills = barsOf(container).map((rect) => rect.getAttribute('fill'))
    expect(fills[0]).not.toBe(fills[1])
  })
})

describe('the scale the chart states', () => {
  const withAxis = (axis: string) =>
    chartOf(
      `<c:barChart><c:axId val="1"/><c:axId val="2"/><c:ser>${categories(['Q1'])}${cache('val', [50])}</c:ser></c:barChart>` +
        `<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/>${axis}</c:valAx>`,
    )

  it('starts where the file says to start, not at zero', () => {
    // A chart fixed at 40 is drawn differently from one starting at zero, and
    // both are ordinary.
    const { container } = draw(
      withAxis('<c:scaling><c:min val="40"/><c:max val="60"/></c:scaling>'),
    )
    expect(container.textContent).toContain('40')
    expect(container.textContent).toContain('60')
  })

  it('draws the scale the other way round when it is reversed', () => {
    // The bottom of a reversed axis is its largest number, so nought moves to
    // the top of the plot.
    const zeroAt = (container: HTMLElement) =>
      Number(
        [...container.querySelectorAll('text')]
          .find((text) => text.textContent === '0')
          ?.getAttribute('y'),
      )

    const upright = zeroAt(draw(withAxis('')).container)
    const reversed = zeroAt(
      draw(withAxis('<c:scaling><c:orientation val="maxMin"/></c:scaling>')).container,
    )

    expect(reversed).toBeLessThan(upright)
  })

  it('takes the number of lines from the unit the chart states', () => {
    const { container } = draw(
      withAxis('<c:scaling><c:min val="0"/><c:max val="100"/></c:scaling><c:majorUnit val="50"/>'),
    )

    expect(container.querySelectorAll('line')).toHaveLength(3)
  })

  it('draws no names along the bottom when the category axis is deleted', () => {
    const { container } = draw(
      chartOf(
        `<c:barChart><c:axId val="1"/><c:ser>${categories(['Q1'])}${cache('val', [1])}</c:ser></c:barChart>` +
          '<c:catAx><c:axId val="1"/><c:delete val="1"/></c:catAx>',
      ),
    )

    expect(container.textContent).not.toContain('Q1')
  })
})

describe('a line through a blank', () => {
  const line = (blanks: string) =>
    given(
      readChart(
        `<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:lineChart><c:ser>` +
          '<c:val><c:numRef><c:numCache><c:ptCount val="3"/>' +
          '<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt>' +
          '</c:numCache></c:numRef></c:val></c:ser></c:lineChart></c:plotArea>' +
          blanks +
          '</c:chart></c:chartSpace>',
      ),
    )

  it('breaks the line by default, which is what a gap means', () => {
    const paths = [...draw(line('')).container.querySelectorAll('path')]
    expect(paths).toHaveLength(2)
  })

  it('bridges the hole when the chart says to span it', () => {
    const paths = [...draw(line('<c:dispBlanksAs val="span"/>')).container.querySelectorAll('path')]
    expect(paths).toHaveLength(1)
  })

  it('drops to the axis when the chart says a blank is a zero', () => {
    const path = draw(line('<c:dispBlanksAs val="zero"/>')).container.querySelector('path')
    expect(path?.getAttribute('d')?.split(/[ML]/u)).toHaveLength(4)
  })
})

describe('a line with markers', () => {
  it('draws one per point when the series asks for them', () => {
    const { container } = draw(
      chartOf(
        '<c:lineChart><c:ser><c:marker><c:symbol val="circle"/><c:size val="8"/></c:marker>' +
          `${categories(['A', 'B'])}${cache('val', [1, 2])}</c:ser></c:lineChart>`,
      ),
    )

    const dots = [...container.querySelectorAll('circle')]
    expect(dots).toHaveLength(2)
    expect(Number(dots[0]?.getAttribute('r'))).toBe(4)
  })

  it('draws none where the series says it has none', () => {
    const { container } = draw(
      chartOf(
        '<c:lineChart><c:ser><c:marker><c:symbol val="none"/></c:marker>' +
          `${categories(['A', 'B'])}${cache('val', [1, 2])}</c:ser></c:lineChart>`,
      ),
    )

    expect(container.querySelectorAll('circle')).toHaveLength(0)
  })

  it('curves through its points when the series is smooth', () => {
    const { container } = draw(
      chartOf(
        `<c:lineChart><c:ser><c:smooth val="1"/>${categories(['A', 'B', 'C'])}${cache('val', [1, 3, 2])}</c:ser></c:lineChart>`,
      ),
    )

    expect(container.querySelector('path')?.getAttribute('d')).toContain('C')
  })
})

describe('a doughnut and a pie', () => {
  it('cuts the hole the chart asks for', () => {
    const small = draw(
      chartOf(
        `<c:doughnutChart><c:holeSize val="20"/><c:ser>${cache('val', [1, 1])}</c:ser></c:doughnutChart>`,
      ),
    ).container.querySelector('path')
    const large = draw(
      chartOf(
        `<c:doughnutChart><c:holeSize val="80"/><c:ser>${cache('val', [1, 1])}</c:ser></c:doughnutChart>`,
      ),
    ).container.querySelector('path')

    // The inner arc's radius is written into the path; a bigger hole is a
    // bigger number in the same place.
    expect(large?.getAttribute('d')?.length).not.toBe(small?.getAttribute('d')?.length)
  })

  it('starts a pie where the chart turns it to', () => {
    const upright = draw(
      chartOf(`<c:pieChart><c:ser>${cache('val', [1, 1])}</c:ser></c:pieChart>`),
    ).container.querySelector('path')
    const turned = draw(
      chartOf(
        `<c:pieChart><c:firstSliceAng val="90"/><c:ser>${cache('val', [1, 1])}</c:ser></c:pieChart>`,
      ),
    ).container.querySelector('path')

    expect(turned?.getAttribute('d')).not.toBe(upright?.getAttribute('d'))
  })
})

describe('a radar', () => {
  const radar = (style = 'marker') =>
    chartOf(
      `<c:radarChart><c:radarStyle val="${style}"/>` +
        `<c:ser>${categories(['A', 'B', 'C'])}${cache('val', [1, 2, 3])}</c:ser></c:radarChart>`,
    )

  it('draws a closed shape across the spokes rather than a frame', () => {
    const { container } = draw(radar())

    expect(container.textContent).not.toContain('Chart')
    // Four rings of grid and the series itself.
    expect(container.querySelectorAll('polygon').length).toBe(5)
  })

  it('names the spokes', () => {
    expect(draw(radar()).container.textContent).toContain('B')
  })

  it('fills the shape only when the chart is a filled radar', () => {
    const outline = [...draw(radar()).container.querySelectorAll('polygon')].pop()
    const area = [...draw(radar('filled')).container.querySelectorAll('polygon')].pop()

    expect(outline?.getAttribute('fill')).toBe('none')
    expect(area?.getAttribute('fill')).not.toBe('none')
  })
})

describe('a plot area somebody moved', () => {
  const laid = (layout: string) =>
    chartOf(
      `<c:layout>${layout}</c:layout>` +
        `<c:barChart>${categories(['A'])}<c:ser>${cache('val', [10])}</c:ser></c:barChart>`,
    )

  const manual = (inner = true) =>
    '<c:manualLayout>' +
    (inner ? '<c:layoutTarget val="inner"/>' : '') +
    '<c:xMode val="edge"/><c:yMode val="edge"/><c:wMode val="edge"/><c:hMode val="edge"/>' +
    '<c:x val="0.25"/><c:y val="0.1"/><c:w val="0.5"/><c:h val="0.5"/></c:manualLayout>'

  it('draws the bars where the layout says, not where the default would', () => {
    const automatic = barsOf(draw(laid('')).container)[0]
    const placed = barsOf(draw(laid(manual())).container)[0]

    // The plot starts a quarter across a 320-wide chart and runs half of it:
    // 80 points in, 160 wide. One category fills the slot, and the gap of 150
    // leaves the bar 64 wide, starting 48 into it.
    expect(Number(placed?.getAttribute('x'))).toBeGreaterThan(Number(automatic?.getAttribute('x')))
    expect(Number(placed?.getAttribute('x'))).toBeCloseTo(128, 0)
    expect(Number(placed?.getAttribute('width'))).toBeCloseTo(64, 0)
  })

  it('leaves room for the labels when the layout measures them too', () => {
    // `outer` includes the axis labels in what it states, so the plotting
    // rectangle starts inside it.
    const inner = Number(barsOf(draw(laid(manual())).container)[0]?.getAttribute('x'))
    const outer = Number(barsOf(draw(laid(manual(false))).container)[0]?.getAttribute('x'))

    expect(outer).toBeGreaterThan(inner)
  })

  it('ignores a layout that would leave nothing to draw in', () => {
    const squashed = barsOf(
      draw(
        laid(
          '<c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/>' +
            '<c:wMode val="edge"/><c:hMode val="edge"/><c:x val="0.48"/><c:y val="0.48"/>' +
            '<c:w val="0.02"/><c:h val="0.02"/></c:manualLayout>',
        ),
      ).container,
    )[0]
    const automatic = barsOf(draw(laid('')).container)[0]

    expect(squashed?.getAttribute('x')).toBe(automatic?.getAttribute('x'))
  })
})
