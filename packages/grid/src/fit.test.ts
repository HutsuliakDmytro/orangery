import { describe, expect, it } from 'vitest'
import { heightNeeded, widthNeeded } from './fit'
import type { FitCell } from './fit'

/**
 * How much room a row or a column needs.
 *
 * Measured against a context that answers by the size of the font it is set
 * to, because that is the whole point of asking the grid rather than the
 * workbook: the same string in a bigger font is a wider column.
 */

const BASE = '12px sans-serif'

/** A canvas that measures the way a canvas does: font size times letters. */
function measuring(): CanvasRenderingContext2D {
  let font = BASE

  const context = {
    get font() {
      return font
    },
    set font(next: string) {
      font = next
    },
    measureText: (text: string) => ({
      width: text.length * (Number(/(\d*\.?\d+)px/u.exec(font)?.[1] ?? 12) * 0.6),
    }),
  }

  return context as unknown as CanvasRenderingContext2D
}

const cell = (text: string, style: FitCell['style'] = null, width?: number): FitCell =>
  width === undefined ? { text, style } : { text, style, width }

describe('the width a column wants', () => {
  it('is the width of its longest value, not of its last', () => {
    const context = measuring()

    const wide = widthNeeded(context, [cell('a very long value indeed'), cell('x')], BASE)
    const narrow = widthNeeded(context, [cell('x')], BASE)

    expect(wide).toBeGreaterThan(narrow)
  })

  it('grows with the font, which is why the grid is the one asked', () => {
    const context = measuring()
    const plain = widthNeeded(context, [cell('Total')], BASE)
    const large = widthNeeded(context, [cell('Total', { font: '24px sans-serif' })], BASE)

    expect(large).toBeGreaterThan(plain)
  })

  it('leaves room beside the text rather than ending at it', () => {
    // A column cut to the exact width of its widest value looks like a
    // mistake, and in a proportional font it clips.
    const context = measuring()
    expect(widthNeeded(context, [cell('x')], BASE)).toBeGreaterThan(context.measureText('x').width)
  })

  it('makes room for an indent', () => {
    const context = measuring()
    const plain = widthNeeded(context, [cell('Total')], BASE)
    const indented = widthNeeded(context, [cell('Total', { indent: 2 })], BASE)

    expect(indented).toBeGreaterThan(plain)
  })

  it('makes room for an icon', () => {
    const context = measuring()
    const plain = widthNeeded(context, [cell('12')], BASE)
    const marked = widthNeeded(
      context,
      [cell('12', { icon: { shape: 'arrow', color: '#000' } })],
      BASE,
    )

    expect(marked).toBeGreaterThan(plain)
  })

  it('ignores a wrapped cell, which has already been told how to fit', () => {
    // Widening the column until the paragraph is on one line is undoing the
    // wrap rather than obeying it.
    const context = measuring()
    const paragraph = 'a sentence long enough to need a good deal of room'

    expect(widthNeeded(context, [cell(paragraph, { wrap: true }), cell('x')], BASE)).toBe(
      widthNeeded(context, [cell('x')], BASE),
    )
  })

  it('counts turned text as it lies', () => {
    // A heading stood on end takes one line's worth of room across, whatever
    // it says.
    const context = measuring()
    const level = widthNeeded(context, [cell('September')], BASE)
    const turned = widthNeeded(context, [cell('September', { rotation: 90 })], BASE)

    expect(turned).toBeLessThan(level)
  })

  it('has no opinion where there is nothing to measure', () => {
    // Which is what keeps a double click on an empty column from collapsing it.
    expect(widthNeeded(measuring(), [cell(''), cell('')], BASE)).toBe(0)
  })
})

describe('the height a row wants', () => {
  it('is one line for ordinary values', () => {
    const context = measuring()
    expect(heightNeeded(context, [cell('Total')], BASE)).toBeLessThan(30)
  })

  it('is as many lines as a wrapped value comes to', () => {
    const context = measuring()
    const words = 'one two three four five six seven eight nine ten'

    const wrapped = heightNeeded(context, [cell(words, { wrap: true }, 60)], BASE)
    const single = heightNeeded(context, [cell(words, null, 60)], BASE)

    expect(wrapped).toBeGreaterThan(single * 3)
  })

  it('grows with the font like the width does', () => {
    const context = measuring()
    const plain = heightNeeded(context, [cell('Total')], BASE)
    const large = heightNeeded(context, [cell('Total', { font: '30px sans-serif' })], BASE)

    expect(large).toBeGreaterThan(plain)
  })

  it('gives stacked letters a line each', () => {
    const context = measuring()
    const stacked = heightNeeded(context, [cell('January', { rotation: 'stacked' })], BASE)

    expect(stacked).toBeGreaterThan(heightNeeded(context, [cell('January')], BASE) * 5)
  })

  it('has no opinion about an empty row', () => {
    expect(heightNeeded(measuring(), [cell('')], BASE)).toBe(0)
  })
})
