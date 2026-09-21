import { describe, expect, it } from 'vitest'
import { parseXml, tagName } from '@orangery/ooxml-core'
import { changeView } from './view-edit'
import { readWorksheet } from './worksheet'

/**
 * How a sheet is looked at.
 *
 * None of this changes a value, and all of it is remembered in the file: a
 * workbook put away at 60 % with its header row frozen opens that way. The
 * reader is the quickest way to ask whether what was written says what it
 * was meant to.
 */

const sheet = (inside: string) =>
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `${inside}<sheetData/></worksheet>`

const viewOf = (xml: string) => readWorksheet(xml)?.view

const plain = sheet('<sheetViews><sheetView workbookViewId="0"/></sheetViews>')

describe('freezing', () => {
  it('holds the rows above the cursor still', () => {
    const after = changeView(plain, { panes: { rows: 1, columns: 0, split: false } })

    expect(viewOf(after)?.panes).toEqual({ rows: 1, columns: 0, split: false })
  })

  it('holds rows and columns together', () => {
    const after = changeView(plain, { panes: { rows: 2, columns: 1, split: false } })

    expect(viewOf(after)?.panes).toEqual({ rows: 2, columns: 1, split: false })
    expect(after).toContain('topLeftCell="B3"')
  })

  it('names the pane the cursor is in, which Excel needs', () => {
    expect(changeView(plain, { panes: { rows: 1, columns: 0, split: false } })).toContain(
      'activePane="bottomLeft"',
    )
    expect(changeView(plain, { panes: { rows: 0, columns: 1, split: false } })).toContain(
      'activePane="topRight"',
    )
  })

  it('unfreezes, taking the selections with it', () => {
    // A selection naming a pane that no longer exists is a file Excel repairs.
    const frozen = changeView(plain, { panes: { rows: 1, columns: 1, split: false } })
    const after = changeView(frozen, { panes: null })

    expect(viewOf(after)?.panes).toBeNull()
    expect(after).not.toContain('<selection')
  })

  it('replaces a freeze rather than adding a second', () => {
    const once = changeView(plain, { panes: { rows: 1, columns: 0, split: false } })
    const twice = changeView(once, { panes: { rows: 3, columns: 0, split: false } })

    expect(viewOf(twice)?.panes?.rows).toBe(3)
    expect(twice.match(/<pane\b/gu)).toHaveLength(1)
  })
})

describe('the zoom', () => {
  it('is written as the percentage it is', () => {
    expect(viewOf(changeView(plain, { zoom: 60 }))?.zoom).toBe(60)
  })

  it('says nothing at all for a hundred, which is the default', () => {
    const after = changeView(changeView(plain, { zoom: 60 }), { zoom: 100 })

    expect(after).not.toContain('zoomScale')
    expect(viewOf(after)?.zoom).toBe(100)
  })
})

describe('the gridlines', () => {
  it('can be turned off', () => {
    expect(viewOf(changeView(plain, { showGridLines: false }))?.showGridLines).toBe(false)
  })

  it('come back without leaving the attribute behind', () => {
    const after = changeView(changeView(plain, { showGridLines: false }), {
      showGridLines: true,
    })

    expect(after).not.toContain('showGridLines')
    expect(viewOf(after)?.showGridLines).toBe(true)
  })
})

describe('a part that had no view at all', () => {
  const bare = sheet('')

  it('gets one, before the cells where the schema wants it', () => {
    const after = changeView(bare, { zoom: 150 })

    expect(viewOf(after)?.zoom).toBe(150)
    expect(after.indexOf('<sheetViews>')).toBeLessThan(after.indexOf('<sheetData'))
    expect(parseXml(after).find((node) => tagName(node) === 'worksheet')).toBeDefined()
  })

  it('is left alone where there is nothing to say', () => {
    expect(changeView(bare, { zoom: 100 })).toBe(bare)
  })
})

describe('what it leaves alone', () => {
  it('keeps the attributes it was not asked about', () => {
    const detailed = sheet(
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0" showRowColHeaders="0"/></sheetViews>',
    )
    const after = changeView(detailed, { zoom: 80 })

    expect(after).toContain('tabSelected="1"')
    expect(viewOf(after)?.showRowColHeaders).toBe(false)
  })

  it('keeps a freeze when only the zoom was asked about', () => {
    const frozen = changeView(plain, { panes: { rows: 1, columns: 0, split: false } })
    expect(viewOf(changeView(frozen, { zoom: 80 }))?.panes?.rows).toBe(1)
  })
})
