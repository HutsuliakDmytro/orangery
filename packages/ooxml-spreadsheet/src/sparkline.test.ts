import { describe, expect, it } from 'vitest'
import { readSparklines, sparklineAt } from './sparkline'

/**
 * The charts that live in a cell.
 *
 * Added to the format after it was finished, so they are in the extension
 * list rather than in the sheet proper — which is one of the few places
 * OOXML's forward compatibility actually worked.
 */

const sheet = (inside: string) =>
  `<?xml version="1.0"?><worksheet><sheetData/><extLst>${inside}</extLst></worksheet>`

const group = (attributes: string, sparklines: string) =>
  sheet(
    '<ext uri="{05C60535-1F16-4FD2-B633-F4F36F0B64E0}" xmlns:x14="x14">' +
      `<x14:sparklineGroups xmlns:xm="xm"><x14:sparklineGroup ${attributes}>` +
      '<x14:colorSeries rgb="FF376092"/><x14:colorNegative rgb="FFD00000"/>' +
      `<x14:sparklines>${sparklines}</x14:sparklines>` +
      '</x14:sparklineGroup></x14:sparklineGroups></ext>',
  )

const one = '<x14:sparkline><xm:f>Sheet1!B2:E2</xm:f><xm:sqref>F2</xm:sqref></x14:sparkline>'

describe('reading them', () => {
  it('reads the kind, the colours and where each one is drawn', () => {
    const [found] = readSparklines(group('type="column"', one))

    expect(found).toMatchObject({
      kind: 'column',
      color: 'FF376092',
      negativeColor: 'FFD00000',
    })
    expect(found?.sparklines[0]).toEqual({
      cell: { row: 1, column: 5 },
      formula: 'Sheet1!B2:E2',
    })
  })

  it('calls a line a line when the file says nothing', () => {
    expect(readSparklines(group('', one))[0]?.kind).toBe('line')
  })

  it('reads a whole column of them, which is how Excel makes them', () => {
    const many =
      one +
      '<x14:sparkline><xm:f>Sheet1!B3:E3</xm:f><xm:sqref>F3</xm:sqref></x14:sparkline>' +
      '<x14:sparkline><xm:f>Sheet1!B4:E4</xm:f><xm:sqref>F4</xm:sqref></x14:sparkline>'

    expect(readSparklines(group('type="stacked"', many))[0]?.sparklines).toHaveLength(3)
  })

  it('passes over an extension that is somebody else"s', () => {
    // A file has several, and the uri is what says which is which.
    const other = sheet('<ext uri="{SOMETHING-ELSE}"><x14:sparklineGroups/></ext>')
    expect(readSparklines(other)).toEqual([])
  })

  it('says nothing about a sheet that has none', () => {
    expect(readSparklines('<?xml version="1.0"?><worksheet><sheetData/></worksheet>')).toEqual([])
  })
})

describe('the one drawn in a cell', () => {
  const groups = readSparklines(group('type="column"', one))

  it('is found with the group whose look it takes', () => {
    // Which is why changing the colour of one changes all of them.
    const found = sparklineAt(groups, { row: 1, column: 5 })

    expect(found?.sparkline.formula).toBe('Sheet1!B2:E2')
    expect(found?.group.kind).toBe('column')
  })

  it('is nothing at all for a cell without one', () => {
    expect(sparklineAt(groups, { row: 0, column: 0 })).toBeNull()
  })
})
