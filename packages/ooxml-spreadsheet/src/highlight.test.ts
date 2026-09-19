import { describe, expect, it } from 'vitest'
import { parseXml, tagName } from '@orangery/ooxml-core'
import { readConditionalFormats } from './conditional'
import { highlightsOf } from './highlight'
import type { HighlightValue } from './highlight'
import { paletteOf } from './colors'

/**
 * The rules, asked about a value.
 *
 * Every case here is one somebody would notice: a number turning red, a bar
 * getting longer, an arrow pointing the other way. The numbers the assertions
 * name are worked out by hand from the spec's own arithmetic rather than
 * copied from a run, so a change that moves them fails rather than agrees.
 */

const palette = paletteOf(
  { colors: new Map([['accent1', '4472C4']]) },
  { foreground: '000000', background: 'FFFFFF' },
)

const formats = (body: string) =>
  readConditionalFormats(
    parseXml(`<worksheet xmlns="x"><sheetData/>${body}</worksheet>`).find(
      (node) => tagName(node) === 'worksheet',
    ) ?? {},
  )

/** A column of values in A1 downwards, which is the shape most rules are written on. */
const column = (values: (number | string | null)[]) => ({
  valueAt: ({ row, column: at }: { row: number; column: number }): HighlightValue | null => {
    if (at !== 0) return null

    const value = values[row]
    if (value === null || value === undefined) return null

    return typeof value === 'number'
      ? { number: value, text: String(value), error: false }
      : { number: null, text: value, error: false }
  },
  extent: { rows: values.length, columns: 1 },
  palette,
})

describe('a cell no rule covers', () => {
  it('has no answer at all, which is what makes this cheap', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" dxfId="0" priority="1" ' +
          'operator="greaterThan"><formula>1</formula></cfRule></conditionalFormatting>',
      ),
      column([5, 5, 5]),
    )

    expect(at({ row: 4, column: 0 })).toBeNull()
    expect(at({ row: 0, column: 3 })).toBeNull()
  })

  it('has none either when it is covered and matches nothing', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" dxfId="0" priority="1" ' +
          'operator="greaterThan"><formula>100</formula></cfRule></conditionalFormatting>',
      ),
      column([5, 5, 5]),
    )

    expect(at({ row: 0, column: 0 })).toBeNull()
  })
})

describe('comparing a cell with a value', () => {
  const rules =
    '<conditionalFormatting sqref="A1:A5">' +
    '<cfRule type="cellIs" dxfId="7" priority="1" operator="greaterThan">' +
    '<formula>100</formula></cfRule>' +
    '<cfRule type="cellIs" dxfId="3" priority="2" operator="between">' +
    '<formula>10</formula><formula>20</formula></cfRule>' +
    '</conditionalFormatting>'

  const at = highlightsOf(formats(rules), column([150, 15, 10, 20, 5]))

  it('names the format of the rule that matched', () => {
    expect(at({ row: 0, column: 0 })?.formats).toEqual([7])
  })

  it('counts both ends of a between, as Excel does', () => {
    expect(at({ row: 1, column: 0 })?.formats).toEqual([3])
    expect(at({ row: 2, column: 0 })?.formats).toEqual([3])
    expect(at({ row: 3, column: 0 })?.formats).toEqual([3])
  })

  it('leaves alone a value outside every rule', () => {
    expect(at({ row: 4, column: 0 })).toBeNull()
  })

  it('compares words as words, without regard to case', () => {
    const words = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2"><cfRule type="cellIs" dxfId="1" priority="1" ' +
          'operator="equal"><formula>"done"</formula></cfRule></conditionalFormatting>',
      ),
      column(['Done', 'doing']),
    )

    expect(words({ row: 0, column: 0 })?.formats).toEqual([1])
    expect(words({ row: 1, column: 0 })).toBeNull()
  })

  it('says nothing about a rule whose operand is another cell', () => {
    // `=$B$1` needs the formula engine. A rule that guessed would colour the
    // wrong cells, which is worse than colouring none.
    const reference = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2"><cfRule type="cellIs" dxfId="1" priority="1" ' +
          'operator="greaterThan"><formula>$B$1</formula></cfRule></conditionalFormatting>',
      ),
      column([500, 1]),
    )

    expect(reference({ row: 0, column: 0 })).toBeNull()
  })
})

describe('looking for words in a cell', () => {
  const at = highlightsOf(
    formats(
      '<conditionalFormatting sqref="A1:A4">' +
        '<cfRule type="containsText" dxfId="2" priority="1" operator="containsText" text="over">' +
        '<formula>NOT(ISERROR(SEARCH("over",A1)))</formula></cfRule>' +
        '<cfRule type="beginsWith" dxfId="5" priority="2" operator="beginsWith" text="DONE">' +
        '<formula>LEFT(A1,4)="DONE"</formula></cfRule>' +
        '</conditionalFormatting>',
    ),
    column(['Overdue', 'done, at last', 'waiting', null]),
  )

  it('finds the word anywhere in the cell, in any case', () => {
    expect(at({ row: 0, column: 0 })?.formats).toEqual([2])
  })

  it('tells the start of a cell from the middle of it', () => {
    expect(at({ row: 1, column: 0 })?.formats).toEqual([5])
  })

  it('leaves a cell that holds neither', () => {
    expect(at({ row: 2, column: 0 })).toBeNull()
  })

  it('finds nothing in a blank, which holds no words', () => {
    expect(at({ row: 3, column: 0 })).toBeNull()
  })
})

describe('rules that need the whole range', () => {
  it('takes the top three by value, ties and all', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A6"><cfRule type="top10" dxfId="1" priority="1" ' +
          'rank="3"/></conditionalFormatting>',
      ),
      column([9, 7, 7, 7, 2, 1]),
    )

    // Three cells share the third-highest value; all of them are in the top
    // three, because the alternative is choosing between them by position.
    expect(at({ row: 0, column: 0 })?.formats).toEqual([1])
    expect(at({ row: 3, column: 0 })?.formats).toEqual([1])
    expect(at({ row: 4, column: 0 })).toBeNull()
  })

  it('takes at least one cell for a percentage that rounds to none', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A7"><cfRule type="top10" dxfId="1" priority="1" ' +
          'percent="1" rank="10"/></conditionalFormatting>',
      ),
      column([1, 2, 3, 4, 5, 6, 7]),
    )

    // Ten percent of seven is nought by arithmetic and one by what anybody means.
    expect(at({ row: 6, column: 0 })?.formats).toEqual([1])
    expect(at({ row: 5, column: 0 })).toBeNull()
  })

  it('finds what is above the mean, and what is exactly on it when asked', () => {
    const above = '<cfRule type="aboveAverage" dxfId="1" priority="1"/>'
    const orEqual = '<cfRule type="aboveAverage" dxfId="2" priority="1" equalAverage="1"/>'
    const values = [1, 2, 3] // mean 2

    const strict = highlightsOf(
      formats(`<conditionalFormatting sqref="A1:A3">${above}</conditionalFormatting>`),
      column(values),
    )
    const inclusive = highlightsOf(
      formats(`<conditionalFormatting sqref="A1:A3">${orEqual}</conditionalFormatting>`),
      column(values),
    )

    expect(strict({ row: 1, column: 0 })).toBeNull()
    expect(inclusive({ row: 1, column: 0 })?.formats).toEqual([2])
  })

  it('finds the values that repeat, and the ones that do not', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A4">' +
          '<cfRule type="duplicateValues" dxfId="1" priority="1"/></conditionalFormatting>',
      ),
      column(['Kyiv', 'Lviv', 'kyiv', null]),
    )

    // Case is not a difference here, any more than it is to Excel.
    expect(at({ row: 0, column: 0 })?.formats).toEqual([1])
    expect(at({ row: 1, column: 0 })).toBeNull()
    expect(at({ row: 3, column: 0 })).toBeNull()
  })
})

describe('a colour scale', () => {
  const scale = (stops: string) =>
    highlightsOf(
      formats(
        `<conditionalFormatting sqref="A1:A5"><cfRule type="colorScale" priority="1"><colorScale>${stops}` +
          '</colorScale></cfRule></conditionalFormatting>',
      ),
      column([0, 25, 50, 75, 100]),
    )

  const two = '<cfvo type="min"/><cfvo type="max"/><color rgb="FF000000"/><color rgb="FFFFFFFF"/>'

  it('gives the ends of the range the ends of the scale', () => {
    const at = scale(two)
    expect(at({ row: 0, column: 0 })?.scale).toBe('000000')
    expect(at({ row: 4, column: 0 })?.scale).toBe('FFFFFF')
  })

  it('mixes the two in proportion in between', () => {
    // Half way between black and white, channel by channel: 255 / 2 = 128.
    expect(scale(two)({ row: 2, column: 0 })?.scale).toBe('808080')
  })

  it('measures a percentile by place in the sorted values, not by distance', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A5"><cfRule type="colorScale" priority="1"><colorScale>' +
          '<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>' +
          '<color rgb="FF000000"/><color rgb="FF808080"/><color rgb="FFFFFFFF"/>' +
          '</colorScale></cfRule></conditionalFormatting>',
      ),
      // The median is 2, which is much nearer the bottom than the middle.
      column([0, 1, 2, 3, 100]),
    )

    expect(at({ row: 2, column: 0 })?.scale).toBe('808080')
  })

  it('resolves a stop stated against the theme', () => {
    const at = scale(
      '<cfvo type="min"/><cfvo type="max"/><color rgb="FF000000"/><color theme="4"/>',
    )
    expect(at({ row: 4, column: 0 })?.scale).toBe('4472C4')
  })

  it('says nothing about a cell holding words', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2"><cfRule type="colorScale" priority="1"><colorScale>' +
          '<cfvo type="min"/><cfvo type="max"/><color rgb="FF000000"/><color rgb="FFFFFFFF"/>' +
          '</colorScale></cfRule></conditionalFormatting>',
      ),
      column(['Kyiv', 'Lviv']),
    )

    expect(at({ row: 0, column: 0 })).toBeNull()
  })
})

describe('a data bar', () => {
  const at = highlightsOf(
    formats(
      '<conditionalFormatting sqref="A1:A3"><cfRule type="dataBar" priority="1"><dataBar>' +
        '<cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/>' +
        '</dataBar></cfRule></conditionalFormatting>',
    ),
    column([0, 50, 100]),
  )

  it('fills the cell in proportion, between the lengths the format allows', () => {
    // 10 % at the bottom, 90 % at the top, and half way between at the middle.
    expect(at({ row: 0, column: 0 })?.bar?.proportion).toBeCloseTo(0.1)
    expect(at({ row: 1, column: 0 })?.bar?.proportion).toBeCloseTo(0.5)
    expect(at({ row: 2, column: 0 })?.bar?.proportion).toBeCloseTo(0.9)
  })

  it('carries the colour the rule states', () => {
    expect(at({ row: 2, column: 0 })?.bar?.color).toBe('638EC6')
  })

  it('fills every bar where every value is the same', () => {
    const flat = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2"><cfRule type="dataBar" priority="1"><dataBar>' +
          '<cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/>' +
          '</dataBar></cfRule></conditionalFormatting>',
      ),
      column([7, 7]),
    )

    expect(flat({ row: 0, column: 0 })?.bar?.proportion).toBeCloseTo(0.9)
  })
})

describe('an icon set', () => {
  const rule = (extra: string) =>
    highlightsOf(
      formats(
        `<conditionalFormatting sqref="A1:A5"><cfRule type="iconSet" priority="1"><iconSet ${extra}>` +
          '<cfvo type="percent" val="0"/><cfvo type="percent" val="33"/>' +
          '<cfvo type="percent" val="67"/></iconSet></cfRule></conditionalFormatting>',
      ),
      column([0, 30, 40, 70, 100]),
    )

  it('puts a value in the band its thresholds describe', () => {
    const at = rule('iconSet="3TrafficLights1"')

    expect(at({ row: 0, column: 0 })?.icon).toMatchObject({ index: 0, count: 3 })
    expect(at({ row: 2, column: 0 })?.icon).toMatchObject({ index: 1 })
    expect(at({ row: 4, column: 0 })?.icon).toMatchObject({ index: 2 })
  })

  it('turns the scale around when the rule asks', () => {
    const at = rule('iconSet="3Arrows" reverse="1"')

    expect(at({ row: 0, column: 0 })?.icon?.index).toBe(2)
    expect(at({ row: 4, column: 0 })?.icon?.index).toBe(0)
  })

  it('names the set, so the caller knows what to draw', () => {
    expect(rule('iconSet="5Quarters"')({ row: 0, column: 0 })?.icon?.set).toBe('5Quarters')
  })

  it('can be asked to stand in for the number rather than sit beside it', () => {
    const at = rule('iconSet="3Flags" showValue="0"')
    expect(at({ row: 0, column: 0 })?.icon?.showValue).toBe(false)
  })
})

describe('rules on top of one another', () => {
  it('layers the formats of every rule that matched, most important first', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2">' +
          '<cfRule type="cellIs" dxfId="9" priority="2" operator="greaterThan">' +
          '<formula>1</formula></cfRule>' +
          '<cfRule type="cellIs" dxfId="4" priority="1" operator="greaterThan">' +
          '<formula>10</formula></cfRule></conditionalFormatting>',
      ),
      column([50, 5]),
    )

    expect(at({ row: 0, column: 0 })?.formats).toEqual([4, 9])
    expect(at({ row: 1, column: 0 })?.formats).toEqual([9])
  })

  it('stops at a rule that says to, leaving the ones below unasked', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A1">' +
          '<cfRule type="cellIs" dxfId="4" priority="1" stopIfTrue="1" operator="greaterThan">' +
          '<formula>10</formula></cfRule>' +
          '<cfRule type="cellIs" dxfId="9" priority="2" operator="greaterThan">' +
          '<formula>1</formula></cfRule></conditionalFormatting>',
      ),
      column([50]),
    )

    expect(at({ row: 0, column: 0 })?.formats).toEqual([4])
  })

  it('orders rules from different blocks as one sequence', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A1"><cfRule type="cellIs" dxfId="9" priority="2" ' +
          'operator="greaterThan"><formula>1</formula></cfRule></conditionalFormatting>' +
          '<conditionalFormatting sqref="A1:A1"><cfRule type="cellIs" dxfId="4" priority="1" ' +
          'operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting>',
      ),
      column([50]),
    )

    expect(at({ row: 0, column: 0 })?.formats).toEqual([4, 9])
  })

  it('lets a bar and a highlight sit on the same cell', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2">' +
          '<cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/>' +
          '<color rgb="FF638EC6"/></dataBar></cfRule>' +
          '<cfRule type="cellIs" dxfId="6" priority="2" operator="greaterThan">' +
          '<formula>10</formula></cfRule></conditionalFormatting>',
      ),
      column([50, 5]),
    )

    const top = at({ row: 0, column: 0 })
    expect(top?.formats).toEqual([6])
    expect(top?.bar).not.toBeNull()
  })
})

describe('what is read and not judged', () => {
  it('leaves an expression rule alone until there is an engine for it', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A2"><cfRule type="expression" dxfId="1" priority="1">' +
          '<formula>$B1="Done"</formula></cfRule></conditionalFormatting>',
      ),
      column([1, 2]),
    )

    expect(at({ row: 0, column: 0 })).toBeNull()
  })

  it('does not let a rule it cannot judge stop the ones below it', () => {
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A1:A1">' +
          '<cfRule type="expression" dxfId="1" priority="1" stopIfTrue="1">' +
          '<formula>$B1="Done"</formula></cfRule>' +
          '<cfRule type="cellIs" dxfId="8" priority="2" operator="greaterThan">' +
          '<formula>1</formula></cfRule></conditionalFormatting>',
      ),
      column([50]),
    )

    expect(at({ row: 0, column: 0 })?.formats).toEqual([8])
  })
})

describe('a rule on a whole column', () => {
  it('costs the cells there are, not the cells there could be', () => {
    const values = Array.from({ length: 20 }, (_, index) => index)
    const source = column(values)

    let asked = 0
    const at = highlightsOf(
      formats(
        '<conditionalFormatting sqref="A:A"><cfRule type="colorScale" priority="1"><colorScale>' +
          '<cfvo type="min"/><cfvo type="max"/><color rgb="FF000000"/><color rgb="FFFFFFFF"/>' +
          '</colorScale></cfRule></conditionalFormatting>',
      ),
      {
        ...source,
        valueAt: (position) => {
          asked += 1
          return source.valueAt(position)
        },
      },
    )

    at({ row: 19, column: 0 })
    at({ row: 0, column: 0 })

    // Twenty cells for the statistics and one per question; a million-row
    // range clamped to nothing would have been a frozen window.
    expect(asked).toBeLessThan(30)
  })
})
