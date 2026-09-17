import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readChart } from './chart'

const DECK = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic/charts.pptx')

async function chartPart(name: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(DECK))
  const part = zip.file(`ppt/charts/${name}`)
  if (part === null) throw new Error(`${name} is not in the fixture`)
  return part.async('string')
}

describe('reading a chart from the deck', () => {
  it('reads a clustered column chart with both its series', async () => {
    const chart = readChart(await chartPart('chart1.xml'))

    expect(chart).toMatchObject({ kind: 'bar', direction: 'col', grouping: 'clustered' })
    expect(chart?.series.map((series) => series.name)).toEqual(['Revenue', 'Costs'])
  })

  it('takes the values from the cache rather than the workbook', async () => {
    // The formula points into an embedded spreadsheet we never open; the cache
    // beside it is what PowerPoint draws from too.
    const chart = readChart(await chartPart('chart1.xml'))

    expect(chart?.series[0]?.values).toEqual([10.5, 14.2, 9.8, 18.1])
    expect(chart?.series[1]?.values).toEqual([7.1, 8.4, 8.9, 10])
  })

  it('reads the categories once, though every series repeats them', async () => {
    const chart = readChart(await chartPart('chart1.xml'))
    expect(chart?.categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
  })

  it('reads where the legend goes', async () => {
    expect(readChart(await chartPart('chart1.xml'))?.legend).toBe('b')
  })

  it('reads a line chart', async () => {
    const chart = readChart(await chartPart('chart2.xml'))
    expect(chart?.kind).toBe('line')
    expect(chart?.series).toHaveLength(2)
  })

  it('reads a pie chart, which has one series', async () => {
    const chart = readChart(await chartPart('chart3.xml'))

    expect(chart?.kind).toBe('pie')
    expect(chart?.series[0]?.values).toEqual([45, 30, 25])
    expect(chart?.categories).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('defaults a legend with no stated position to the right', async () => {
    expect(readChart(await chartPart('chart2.xml'))?.legend).toBe('r')
  })

  it('shows no legend where the chart has no legend element', async () => {
    expect(readChart(await chartPart('chart3.xml'))?.legend).toBeNull()
  })
})

describe('sparse points', () => {
  const sparse = (points: string) =>
    readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:lineChart>' +
        '<c:ser><c:val><c:numRef><c:numCache><c:ptCount val="4"/>' +
        points +
        '</c:numCache></c:numRef></c:val></c:ser>' +
        '</c:lineChart></c:plotArea></c:chart></c:chartSpace>',
    )

  it('puts each point at the index it states, leaving gaps null', () => {
    // A chart with a blank cell is ordinary. Reading points in document order
    // shifts everything after the gap one place left.
    const chart = sparse('<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="3"><c:v>4</c:v></c:pt>')

    expect(chart?.series[0]?.values).toEqual([1, null, null, 4])
  })

  it('trusts ptCount for the length, not how many points were written', () => {
    expect(sparse('<c:pt idx="1"><c:v>2</c:v></c:pt>')?.series[0]?.values).toHaveLength(4)
  })

  it('reads a non-numeric point as a gap rather than NaN', () => {
    expect(sparse('<c:pt idx="0"><c:v>#N/A</c:v></c:pt>')?.series[0]?.values[0]).toBeNull()
  })
})

describe('a chart we do not draw', () => {
  it('is reported as unknown rather than as nothing', () => {
    // So the frame can be labelled instead of left blank.
    const chart = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:radarChart/></c:plotArea></c:chart></c:chartSpace>',
    )

    expect(chart?.kind).toBe('unknown')
  })

  it('is null only when there is no plot area at all', () => {
    expect(readChart('<c:chartSpace xmlns:c="x"/>')).toBeNull()
    expect(readChart('<nonsense/>')).toBeNull()
  })
})
