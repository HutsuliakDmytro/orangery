import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartFrame } from './document-chart-view'

/**
 * A chart in a document, drawn.
 *
 * Until now a `w:drawing` holding a chart was preserved and shown as nothing.
 * These are about the difference.
 */

const chartPart = (plotArea: string) =>
  `<c:chartSpace xmlns:c="c"><c:chart><c:plotArea>${plotArea}</c:plotArea></c:chart></c:chartSpace>`

const bars = chartPart(
  '<c:barChart><c:ser><c:val><c:numRef><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:val></c:ser></c:barChart>',
)

const frame = (xml: string | null, themeColors: [string, string][] = []) =>
  render(<ChartFrame width={432} height={252} xml={xml} themeColors={themeColors} />)

describe('a chart in a document', () => {
  it('draws the chart the part describes', () => {
    const { container } = frame(bars)

    // Two bars, plus the white backing the renderer lays down.
    expect(container.querySelectorAll('rect').length).toBe(3)
  })

  it('colours it with the document theme rather than a fixed palette', () => {
    const { container } = frame(bars, [['accent1', '#00AA00']])
    const bar = [...container.querySelectorAll('rect')].find(
      (rect) => rect.getAttribute('fill') !== '#FFFFFF',
    )

    expect(bar?.getAttribute('fill')).toBe('#00AA00')
  })

  it('keeps the space a chart takes even when its part is missing', () => {
    // The drawing is still in the file and still saved; the line must not
    // reflow as though nothing were there.
    const { container } = frame(null)
    const span = container.querySelector('span[data-chart]')

    expect(span).not.toBeNull()
    expect(span?.getAttribute('style')).toContain('432pt')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('frames and names a kind it cannot draw', () => {
    const { container } = frame(chartPart('<c:surfaceChart/>'))
    expect(container.textContent).toContain('Surface chart')
  })
})
