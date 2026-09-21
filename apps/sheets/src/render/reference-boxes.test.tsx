import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ReferenceBoxes } from './reference-boxes'
import { REFERENCE_COLORS } from './reference-colors'

/**
 * The cells a formula names, boxed while it is being written.
 *
 * The colours in the text and the boxes on the sheet are the same colours in
 * the same order, and that correspondence is the whole feature.
 */

const metrics = { rowHeight: 20, columnWidth: 64, headerWidth: 40, headerHeight: 20 }

/** A hex as the DOM gives it back. */
const rgb = (hex: string): string => {
  const parts = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  return `rgb(${parts.map(String).join(', ')})`
}

const boxes = (text: string) =>
  render(
    <ReferenceBoxes text={text} sheet="Budget" metrics={metrics} scrollX={0} scrollY={0} />,
  ).container.querySelectorAll('div')

describe('boxing what a formula names', () => {
  it('draws one box per reference', () => {
    expect(boxes('=A1+B2')).toHaveLength(2)
  })

  it('draws a range as one box the size of the range', () => {
    const drawn = boxes('=SUM(A1:B2)')

    expect(drawn).toHaveLength(1)
    expect(drawn[0]?.style.width).toBe('128px')
    expect(drawn[0]?.style.height).toBe('40px')
  })

  it('colours them in the order they were written', () => {
    // The order is what matters: the third reference in the text is the third
    // box on the sheet, and that is how a formula is read.
    const drawn = boxes('=A1+B2+C3')
    const colors = [...drawn].map((one) => one.style.borderColor)

    expect(new Set(colors).size).toBe(3)
    expect(colors[0]).toBe(rgb(REFERENCE_COLORS[0]))
    expect(colors[1]).toBe(rgb(REFERENCE_COLORS[1]))
  })

  it('draws nothing for text that is not a formula', () => {
    // `Northampton` is a town, not a half-typed reference.
    expect(boxes('Northampton')).toHaveLength(0)
  })

  it('leaves out a reference to another sheet or another workbook', () => {
    expect(boxes('=Notes!A1')).toHaveLength(0)
    expect(boxes('=[1]Sheet1!A1')).toHaveLength(0)
  })

  it('puts a box where the cell is, headers and scroll allowed for', () => {
    const drawn = render(
      <ReferenceBoxes text="=B3" sheet="Budget" metrics={metrics} scrollX={10} scrollY={5} />,
    ).container.querySelectorAll('div')

    expect(drawn[0]?.style.left).toBe('94px')
    expect(drawn[0]?.style.top).toBe('55px')
  })
})
