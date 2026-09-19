import { children, findDescendant, parseXml, tagName } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { allSeries, readChart } from './chart'
import { applyChartEdits } from './chart-edit'
import type { ChartEdit } from './chart-edit'

/**
 * Editing a chart without rewriting it.
 *
 * Every test here asks the same two questions: did the edit happen, and is
 * everything nobody asked about still there. The second is the one that costs a
 * user their file.
 */

const cache = (tag: string, values: readonly number[]) =>
  `<c:${tag}><c:numRef><c:f>Sheet1!$B$2:$B$${String(values.length + 1)}</c:f>` +
  `<c:numCache><c:ptCount val="${String(values.length)}"/>` +
  values
    .map((value, index) => `<c:pt idx="${String(index)}"><c:v>${String(value)}</c:v></c:pt>`)
    .join('') +
  `</c:numCache></c:numRef></c:${tag}>`

const categories = (names: readonly string[]) =>
  `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${String(names.length + 1)}</c:f>` +
  `<c:strCache><c:ptCount val="${String(names.length)}"/>` +
  names.map((name, index) => `<c:pt idx="${String(index)}"><c:v>${name}</c:v></c:pt>`).join('') +
  '</c:strCache></c:strRef></c:cat>'

/**
 * A chart part with the things we do not model in it.
 *
 * The `c:extLst`, the `c:txPr`, the `c:spPr` with an effect on it and the
 * unmodelled `c:dropLines` are the point of the fixture: they are what a real
 * chart carries and what a rebuilt one would lose.
 */
const PART =
  '<c:chartSpace xmlns:c="c" xmlns:a="a" xmlns:r="r"><c:date1904 val="0"/><c:style val="34"/>' +
  '<c:chart><c:plotArea><c:layout/>' +
  '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
  '<c:ser><c:idx val="0"/><c:order val="0"/>' +
  '<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/>' +
  '<c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
  '<c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>' +
  '<a:effectLst><a:outerShdw blurRad="40000"/></a:effectLst></c:spPr>' +
  `${categories(['Q1', 'Q2'])}${cache('val', [10, 20])}` +
  '<c:extLst><c:ext uri="{C3380CC4}"><c16:uniqueId xmlns:c16="c16" val="{1}"/></c:ext></c:extLst>' +
  '</c:ser>' +
  '<c:gapWidth val="150"/><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
  '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
  '<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
  '<c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>' +
  '<c:txPr><a:bodyPr rot="-60000000"/></c:txPr></c:valAx>' +
  '</c:plotArea><c:legend><c:legendPos val="b"/></c:legend>' +
  '<c:plotVisOnly val="1"/></c:chart>' +
  '<c:externalData r:id="rId3"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>'

const edited = (edits: readonly ChartEdit[]): string => {
  const written = applyChartEdits(PART, edits)
  if (written === null) throw new Error('the edit changed nothing')
  return written
}

/** The direct children of an element, in the order they were written. */
const tagsIn = (xml: string, tag: string): string[] => {
  const root = parseXml(xml).find((node) => tagName(node) === 'c:chartSpace')
  const node =
    root === undefined ? undefined : tag === 'c:chartSpace' ? root : findDescendant(root, tag)

  return node === undefined ? [] : children(node).map((child) => tagName(child) ?? '')
}

describe('an edit nobody made', () => {
  it('changes nothing and says so', () => {
    // A caller that wrote unconditionally would turn a chart nobody touched
    // into a changed part, and a round-trip diff into a rewritten file.
    expect(applyChartEdits(PART, [])).toBeNull()
  })

  it('leaves a chart with no plot area alone', () => {
    expect(
      applyChartEdits('<c:chartSpace xmlns:c="c"/>', [{ kind: 'legend', position: 'r' }]),
    ).toBeNull()
  })

  it('reports nothing changed when the thing edited is not there', () => {
    expect(applyChartEdits(PART, [{ kind: 'seriesColor', series: 9, color: null }])).toBeNull()
    expect(applyChartEdits(PART, [{ kind: 'axis', id: '99', hidden: true }])).toBeNull()
  })
})

describe('what an edit leaves alone', () => {
  const written = edited([{ kind: 'legend', position: 't' }])

  it('keeps the parts of the chart nothing asked about', () => {
    expect(written).toContain('c16:uniqueId')
    expect(written).toContain('a:outerShdw')
    expect(written).toContain('<c:style val="34"/>')
    expect(written).toContain('rot="-60000000"')
    expect(written).toContain('<c:externalData r:id="rId3">')
  })

  it('keeps the data where it was, cache and reference both', () => {
    const chart = readChart(written)
    expect(chart === null ? [] : allSeries(chart)[0]?.values).toEqual([10, 20])
    expect(written).toContain('Sheet1!$B$2:$B$3')
  })
})

describe('the title', () => {
  it('is written where the schema puts it, before the plot area', () => {
    const written = edited([{ kind: 'title', text: 'Quarterly revenue' }])

    expect(written).toContain('<a:t>Quarterly revenue</a:t>')
    expect(tagsIn(written, 'c:chart').slice(0, 2)).toEqual(['c:title', 'c:plotArea'])
  })

  it('says nothing about deleted titles in a chart that never had one', () => {
    // `c:autoTitleDeleted` is a statement about a title somebody removed. A
    // chart getting its first title is not making that statement.
    expect(edited([{ kind: 'title', text: 'Revenue' }])).not.toContain('c:autoTitleDeleted')
  })

  it('clears the deleted mark on a chart that had one', () => {
    const titled = edited([{ kind: 'title', text: 'Gone soon' }])
    const removed = applyChartEdits(titled, [{ kind: 'title', text: null }]) ?? ''
    const back = applyChartEdits(removed, [{ kind: 'title', text: 'Revenue' }]) ?? ''

    expect(removed).toContain('<c:autoTitleDeleted val="1"/>')
    expect(back).toContain('<c:autoTitleDeleted val="0"/>')
  })

  it('keeps the formatting of the words it replaces', () => {
    const titled = applyChartEdits(
      PART.replace(
        '<c:plotArea>',
        '</c:plotArea><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r>' +
          '<a:rPr b="1" sz="1800"/><a:t>Old</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea>',
      ).replace('</c:plotArea><c:title>', '<c:title>'),
      [{ kind: 'title', text: 'New' }],
    )

    expect(titled).toContain('b="1"')
    expect(titled).toContain('<a:t>New</a:t>')
    expect(titled).not.toContain('<a:t>Old</a:t>')
  })

  it('taking it away marks it deleted, or Office writes one back', () => {
    const titled = edited([{ kind: 'title', text: 'Gone soon' }])
    const removed = applyChartEdits(titled, [{ kind: 'title', text: null }]) ?? ''

    expect(removed).not.toContain('Gone soon')
    expect(removed).toContain('<c:autoTitleDeleted val="1"/>')
  })
})

describe('the legend', () => {
  it('moves without being rebuilt', () => {
    expect(edited([{ kind: 'legend', position: 't' }])).toContain('<c:legendPos val="t"/>')
  })

  it('goes away entirely when the chart is to show none', () => {
    const written = edited([{ kind: 'legend', position: null }])
    expect(written).not.toContain('c:legend')
  })

  it('comes back after the plot area, where it belongs', () => {
    const none = edited([{ kind: 'legend', position: null }])
    const back = applyChartEdits(none, [{ kind: 'legend', position: 'r' }]) ?? ''

    expect(tagsIn(back, 'c:chart')).toEqual(['c:plotArea', 'c:legend', 'c:plotVisOnly'])
  })
})

describe("a series' colour", () => {
  it('replaces the fill rather than sitting beside it', () => {
    const written = edited([
      {
        kind: 'seriesColor',
        series: 0,
        color: { source: { kind: 'srgb', hex: '#FF0000' }, transforms: [] },
      },
    ])

    expect(written).toContain('<a:srgbClr val="FF0000"/>')
    expect(written).not.toContain('<a:schemeClr val="accent1"/>')
  })

  it('keeps the effects on the same properties', () => {
    const written = edited([
      {
        kind: 'seriesColor',
        series: 0,
        color: { source: { kind: 'scheme', name: 'accent3' }, transforms: [] },
      },
    ])

    expect(written).toContain('a:outerShdw')
    expect(written).toContain('<a:schemeClr val="accent3"/>')
  })

  it('writes the fill before the effects, which is the order a:spPr wants', () => {
    const written = edited([
      {
        kind: 'seriesColor',
        series: 0,
        color: { source: { kind: 'srgb', hex: '#00FF00' }, transforms: [] },
      },
    ])

    expect(written.indexOf('a:solidFill')).toBeLessThan(written.indexOf('a:effectLst'))
  })

  it('keeps a theme colour symbolic, with its modifiers', () => {
    const written = edited([
      {
        kind: 'seriesColor',
        series: 0,
        color: {
          source: { kind: 'scheme', name: 'accent2' },
          transforms: [{ kind: 'lumMod', value: 0.6 }],
        },
      },
    ])

    expect(written).toContain('<a:schemeClr val="accent2"><a:lumMod val="60000"/></a:schemeClr>')
  })

  it('takes the fill away when the colour is cleared', () => {
    const written = edited([{ kind: 'seriesColor', series: 0, color: null }])
    expect(written).not.toContain('a:solidFill')
    expect(written).toContain('a:outerShdw')
  })
})

describe('data labels', () => {
  it('writes the flags Office writes, not only the one asked for', () => {
    // A chart that says only `showVal` leaves the rest to a reader's defaults,
    // and two readers disagree about them.
    const written = edited([{ kind: 'labels', plot: 0, show: { values: true } }])

    expect(written).toContain('<c:showVal val="1"/>')
    expect(written).toContain('<c:showCatName val="0"/>')
    expect(written).toContain('<c:showPercent val="0"/>')
  })

  it('puts them before the gap width, where a bar chart wants them', () => {
    const written = edited([{ kind: 'labels', plot: 0, show: { values: true } }])
    const tags = tagsIn(written, 'c:barChart')

    expect(tags.indexOf('c:dLbls')).toBeLessThan(tags.indexOf('c:gapWidth'))
    expect(tags.indexOf('c:ser')).toBeLessThan(tags.indexOf('c:dLbls'))
  })
})

describe('how a group is drawn', () => {
  it('writes the numbers in schema order', () => {
    const written = edited([{ kind: 'plotOptions', plot: 0, gapWidth: 40, overlap: -10 }])
    const tags = tagsIn(written, 'c:barChart')

    expect(written).toContain('<c:gapWidth val="40"/>')
    expect(written).toContain('<c:overlap val="-10"/>')
    expect(tags.indexOf('c:gapWidth')).toBeLessThan(tags.indexOf('c:overlap'))
    expect(tags.indexOf('c:overlap')).toBeLessThan(tags.indexOf('c:axId'))
  })

  it('ignores a number the kind has no room for', () => {
    // A bar chart with a hole size in it is a file Excel offers to repair.
    expect(applyChartEdits(PART, [{ kind: 'plotOptions', plot: 0, holeSize: 50 }])).toBeNull()
  })
})

describe('an axis', () => {
  it('takes a scale, written inside c:scaling in its own order', () => {
    const written = edited([{ kind: 'axis', id: '2', min: 0, max: 50, majorUnit: 10 }])

    expect(written).toContain('<c:min val="0"/>')
    expect(written).toContain('<c:max val="50"/>')
    expect(written.indexOf('<c:max')).toBeLessThan(written.indexOf('<c:min'))
    expect(written).toContain('<c:majorUnit val="10"/>')
  })

  it('unsets a bound rather than writing a null', () => {
    const bounded = edited([{ kind: 'axis', id: '2', min: 5 }])
    const loosened = applyChartEdits(bounded, [{ kind: 'axis', id: '2', min: null }]) ?? ''

    expect(loosened).not.toContain('c:min')
    expect(loosened).toContain('c:orientation')
  })

  it('unlinks a number format, or Excel takes it from the cells again', () => {
    const written = edited([{ kind: 'axis', id: '2', numberFormat: '#,##0.0' }])
    expect(written).toContain('<c:numFmt formatCode="#,##0.0" sourceLinked="0"/>')
  })

  it('hides itself without losing the scale it states', () => {
    const written = edited([{ kind: 'axis', id: '2', hidden: true, max: 80 }])

    expect(written).toContain('<c:delete val="1"/>')
    expect(written).toContain('<c:max val="80"/>')
  })

  it('titles itself, after the gridlines and before the format', () => {
    const written = edited([{ kind: 'axis', id: '2', title: 'Millions' }])
    const tags = tagsIn(written, 'c:valAx')

    expect(written).toContain('<a:t>Millions</a:t>')
    expect(tags.indexOf('c:title')).toBeLessThan(tags.indexOf('c:crossAx'))
    expect(tags.indexOf('c:axPos')).toBeLessThan(tags.indexOf('c:title'))
  })
})

describe('changing the kind of chart', () => {
  it('renames the group and keeps its series', () => {
    const written = edited([{ kind: 'plotType', plot: 0, to: 'line' }])
    const chart = readChart(written)

    expect(chart?.plots[0]?.kind).toBe('line')
    expect(chart === null ? [] : allSeries(chart)[0]?.values).toEqual([10, 20])
    expect(chart?.categories).toEqual(['Q1', 'Q2'])
  })

  it('drops what the new kind has no room for', () => {
    // A line chart carrying a bar's direction and gap is a repaired file.
    const written = edited([{ kind: 'plotType', plot: 0, to: 'line' }])

    expect(written).not.toContain('c:barDir')
    expect(written).not.toContain('c:gapWidth')
    expect(written).toContain('<c:grouping val="standard"/>')
  })

  it('keeps the series formatting and the reference to the cells', () => {
    const written = edited([{ kind: 'plotType', plot: 0, to: 'area' }])

    expect(written).toContain('a:outerShdw')
    expect(written).toContain('Sheet1!$B$2:$B$3')
    expect(written).toContain('c16:uniqueId')
  })

  it('writes the series children in the order the new kind wants', () => {
    const written = edited([{ kind: 'plotType', plot: 0, to: 'line' }])
    const tags = tagsIn(written, 'c:ser')

    expect(tags).toEqual(['c:idx', 'c:order', 'c:tx', 'c:spPr', 'c:cat', 'c:val', 'c:extLst'])
  })

  it('turns a chart into a pie without leaving its axes behind', () => {
    const written = edited([{ kind: 'plotType', plot: 0, to: 'pie' }])

    expect(written).not.toContain('c:axId')
    expect(written).not.toContain('c:catAx')
    expect(written).not.toContain('c:valAx')
    expect(readChart(written)?.plots[0]?.kind).toBe('pie')
  })

  it('gives a pie turned back into columns a pair of axes to stand on', () => {
    const pie = edited([{ kind: 'plotType', plot: 0, to: 'pie' }])
    const bars = applyChartEdits(pie, [{ kind: 'plotType', plot: 0, to: 'bar' }]) ?? ''
    const chart = readChart(bars)

    expect(chart?.axes.map((axis) => axis.kind)).toEqual(['category', 'value'])
    expect(bars).toContain('<c:barDir val="col"/>')
    expect(chart === null ? [] : allSeries(chart)[0]?.values).toEqual([10, 20])
  })

  it('renames a scatter’s x and y to the names every other kind uses', () => {
    const scatter = edited([{ kind: 'plotType', plot: 0, to: 'scatter' }])
    expect(scatter).toContain('c:xVal')
    expect(scatter).toContain('c:yVal')

    const back = applyChartEdits(scatter, [{ kind: 'plotType', plot: 0, to: 'bar' }]) ?? ''
    const chart = readChart(back)

    expect(back).not.toContain('c:xVal')
    expect(chart?.categories).toEqual(['Q1', 'Q2'])
    expect(chart === null ? [] : allSeries(chart)[0]?.values).toEqual([10, 20])
  })

  it('makes a doughnut out of a pie and gives it its hole', () => {
    const pie = edited([{ kind: 'plotType', plot: 0, to: 'pie' }])
    const ring = applyChartEdits(pie, [
      { kind: 'plotType', plot: 0, to: 'doughnut' },
      { kind: 'plotOptions', plot: 0, holeSize: 60 },
    ])

    expect(ring).toContain('<c:holeSize val="60"/>')
    expect(readChart(ring ?? '')?.plots[0]?.kind).toBe('doughnut')
  })
})

describe('an edit that mentions one thing', () => {
  const horizontal = PART.replace('<c:barDir val="col"/>', '<c:barDir val="bar"/>').replace(
    '<c:grouping val="clustered"/>',
    '<c:grouping val="stacked"/>',
  )

  it('leaves the direction alone when the stacking changes', () => {
    // The panel sends one property at a time, and a default written over the
    // silence would stand a horizontal chart upright.
    const written =
      applyChartEdits(horizontal, [
        { kind: 'plotType', plot: 0, to: 'bar', grouping: 'percentStacked' },
      ]) ?? ''

    expect(written).toContain('<c:barDir val="bar"/>')
    expect(written).toContain('<c:grouping val="percentStacked"/>')
  })

  it('leaves the stacking alone when the direction changes', () => {
    const written =
      applyChartEdits(horizontal, [{ kind: 'plotType', plot: 0, to: 'bar', direction: 'col' }]) ??
      ''

    expect(written).toContain('<c:barDir val="col"/>')
    expect(written).toContain('<c:grouping val="stacked"/>')
  })

  it('keeps a scatter’s own style through an edit that says nothing about it', () => {
    const scatter = applyChartEdits(PART, [{ kind: 'plotType', plot: 0, to: 'scatter' }]) ?? ''
    const marked = scatter.replace(
      '<c:scatterStyle val="lineMarker"/>',
      '<c:scatterStyle val="marker"/>',
    )
    const again = applyChartEdits(marked, [{ kind: 'plotType', plot: 0, to: 'scatter' }])

    // Nothing to change: the kind is the kind it already is and the style is
    // the style it already has.
    expect(again).toBeNull()
  })

  it('does not carry a bar’s clustered into a line, which has no such word', () => {
    const line = applyChartEdits(PART, [{ kind: 'plotType', plot: 0, to: 'line' }]) ?? ''

    expect(line).toContain('<c:grouping val="standard"/>')
    expect(line).not.toContain('clustered')
  })

  it('keeps a stacked bar stacked when it becomes a line, which stacks too', () => {
    const stacked = PART.replace('<c:grouping val="clustered"/>', '<c:grouping val="stacked"/>')
    const line = applyChartEdits(stacked, [{ kind: 'plotType', plot: 0, to: 'line' }]) ?? ''

    expect(line).toContain('<c:grouping val="stacked"/>')
  })
})
