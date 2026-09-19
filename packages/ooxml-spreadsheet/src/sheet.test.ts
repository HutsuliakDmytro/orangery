import { describe, expect, it } from 'vitest'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { newWorkbook } from './new-workbook'
import { clearCell, insertRow, openSheet, readCell, removeRow, saveSheet, writeCell } from './sheet'
import { readSharedStrings, readWorkbook, sheetPath } from './workbook'

/**
 * A worksheet, changed and written back.
 *
 * The fixture is shaped like the workbook a chart embeds, because that is what
 * this is for first: a sheet with a header row, a column of names held in the
 * shared table and two columns of numbers.
 */

const SHEET =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="x"><dimension ref="A1:C3"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
  '<cols><col min="1" max="1" width="10.7" customWidth="1"/></cols><sheetData>' +
  '<row r="1" spans="1:3"><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>3</v></c></row>' +
  '<row r="2" spans="1:3"><c r="A2" s="1" t="s"><v>0</v></c><c r="B2" s="1"><v>10.5</v></c><c r="C2" s="1"><v>7.1</v></c></row>' +
  '<row r="3" spans="1:3"><c r="A3" s="1" t="s"><v>1</v></c><c r="B3" s="1"><v>14.2</v></c><c r="C3" s="1"><v>8.4</v></c></row>' +
  '</sheetData><pageMargins left="0.7" right="0.7"/></worksheet>'

const WORKBOOK =
  '<workbook xmlns="x" xmlns:r="r"><workbookPr defaultThemeVersion="124226"/>' +
  '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'

const RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>'

const STRINGS =
  '<sst xmlns="x" count="4" uniqueCount="4"><si><t>Q1</t></si><si><t>Q2</t></si>' +
  '<si><t>Revenue</t></si><si><t>Co</t><t>sts</t></si></sst>'

function workbook(): OoxmlPackage {
  const pkg: OoxmlPackage = { parts: new Map() }
  setPartText(pkg, 'xl/workbook.xml', WORKBOOK)
  setPartText(pkg, 'xl/_rels/workbook.xml.rels', RELS)
  setPartText(pkg, 'xl/worksheets/sheet1.xml', SHEET)
  setPartText(pkg, 'xl/sharedStrings.xml', STRINGS)
  return pkg
}

const opened = (pkg: OoxmlPackage) => {
  const sheet = openSheet(pkg, 'xl/worksheets/sheet1.xml')
  if (sheet === null) throw new Error('the part holds no worksheet')
  return sheet
}

/** The sheet as text after the changes, which is what the file would hold. */
function saved(pkg: OoxmlPackage, change: (sheet: ReturnType<typeof opened>) => void): string {
  const sheet = opened(pkg)
  change(sheet)
  saveSheet(pkg, sheet)
  return getPartText(pkg, 'xl/worksheets/sheet1.xml') ?? ''
}

describe('the workbook around it', () => {
  it('finds the part a sheet name refers to', () => {
    expect(sheetPath(workbook(), 'Sheet1')).toBe('xl/worksheets/sheet1.xml')
  })

  it('falls back to the first sheet for a name it does not have', () => {
    // An embedded workbook has one sheet, and a chart that names it something
    // else is still pointing at the only cells there are.
    expect(sheetPath(workbook(), 'Chart data')).toBe('xl/worksheets/sheet1.xml')
  })

  it('reads the date system, which decides what every date means', () => {
    expect(readWorkbook(workbook())?.date1904).toBe(false)
  })

  it('reads the shared table, joining an entry split across runs', () => {
    expect(readSharedStrings(workbook())).toEqual(['Q1', 'Q2', 'Revenue', 'Costs'])
  })
})

describe('reading a cell', () => {
  const strings = readSharedStrings(workbook())

  it('reads a number as a number', () => {
    expect(readCell(opened(workbook()), 'B2', strings)).toBe(10.5)
  })

  it('reads a shared string through the table rather than as its index', () => {
    // The classic way to show 0 where Q1 was meant.
    expect(readCell(opened(workbook()), 'A2', strings)).toBe('Q1')
    expect(readCell(opened(workbook()), 'B1', strings)).toBe('Revenue')
  })

  it('reads an empty cell as nothing', () => {
    expect(readCell(opened(workbook()), 'A1', strings)).toBeNull()
    expect(readCell(opened(workbook()), 'Z99', strings)).toBeNull()
  })
})

describe('writing a cell', () => {
  it('changes the number and leaves the style on it', () => {
    const xml = saved(workbook(), (sheet) => {
      writeCell(sheet, 'B2', 99)
    })

    expect(xml).toContain('<c r="B2" s="1" t="n"><v>99</v></c>')
  })

  it('writes words as an inline string, leaving the shared table alone', () => {
    const pkg = workbook()
    const xml = saved(pkg, (sheet) => {
      writeCell(sheet, 'A2', 'Q5')
    })

    expect(xml).toContain('<is><t>Q5</t></is>')
    expect(xml).toContain('t="inlineStr"')
    expect(getPartText(pkg, 'xl/sharedStrings.xml')).toBe(STRINGS)
  })

  it('rewrites the type with the value, or a number is read as an index', () => {
    const xml = saved(workbook(), (sheet) => {
      writeCell(sheet, 'A2', 42)
    })

    expect(xml).toContain('<c r="A2" s="1" t="n"><v>42</v></c>')
    expect(xml).not.toContain('<c r="A2" s="1" t="s">')
  })

  it('makes a cell that was not there, in its column’s place', () => {
    const xml = saved(workbook(), (sheet) => {
      writeCell(sheet, 'A1', 'Quarter')
    })

    // Before B1, not appended after it: Excel sorts an out-of-order row on
    // save, which turns a one-cell edit into a whole-file diff.
    expect(xml.indexOf('r="A1"')).toBeLessThan(xml.indexOf('r="B1"'))
  })

  it('makes a row that was not there, in its own place', () => {
    const xml = saved(workbook(), (sheet) => {
      writeCell(sheet, 'B5', 1)
      writeCell(sheet, 'B4', 2)
    })

    expect(xml.indexOf('r="4"')).toBeLessThan(xml.indexOf('r="5"'))
  })

  it('grows the stated extent of the sheet to cover what was written', () => {
    const xml = saved(workbook(), (sheet) => {
      writeCell(sheet, 'E9', 1)
    })

    expect(xml).toContain('<dimension ref="A1:E9"/>')
  })

  it('leaves everything it was not asked about where it was', () => {
    const xml = saved(workbook(), (sheet) => {
      writeCell(sheet, 'B2', 1)
    })

    expect(xml).toContain('<col min="1" max="1" width="10.7" customWidth="1"/>')
    expect(xml).toContain('<pageMargins left="0.7" right="0.7"/>')
    expect(xml).toContain('spans="1:3"')
  })
})

describe('rows', () => {
  it('renumbers everything below an inserted row, cells included', () => {
    const xml = saved(workbook(), (sheet) => {
      insertRow(sheet, 1, (column) => (column === 0 ? 'New' : 0))
    })

    // A sheet where two rows call themselves the second is one Excel repairs.
    expect(xml).toContain('<row r="2"><c r="A2" t="inlineStr"><is><t>New</t></is></c>')
    expect(xml).toContain('<c r="B3" s="1"><v>10.5</v></c>')
    expect(xml).toContain('<row r="4" spans="1:3">')
  })

  it('shapes the new row like the one it goes in front of', () => {
    const xml = saved(workbook(), (sheet) => {
      insertRow(sheet, 1, () => 0)
    })

    expect(xml).toContain('<c r="A2" t="n"><v>0</v></c>')
    expect(xml).toContain('<c r="C2" t="n"><v>0</v></c>')
  })

  it('closes the gap behind a row taken away', () => {
    const xml = saved(workbook(), (sheet) => {
      removeRow(sheet, 1)
    })

    expect(xml).not.toContain('10.5')
    expect(xml).toContain('<row r="2" spans="1:3"><c r="A2" s="1" t="s"><v>1</v></c>')
  })

  it('says so when the row is not there', () => {
    const sheet = opened(workbook())
    expect(removeRow(sheet, 40)).toBe(false)
    expect(insertRow(sheet, 40, () => 0)).toBe(false)
  })
})

describe('a workbook made from nothing', () => {
  const made = () =>
    newWorkbook([
      {
        name: 'Sheet1',
        rows: [
          [null, 'Revenue'],
          ['Q1', 10.5],
          ['Q2', 14.2],
        ],
      },
    ])

  it('holds the parts Excel insists on', () => {
    const pkg = made()

    expect([...pkg.parts.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ])
  })

  it('writes the cells where the rows put them', () => {
    const xml = getPartText(made(), 'xl/worksheets/sheet1.xml') ?? ''

    expect(xml).toContain('<c r="B1" t="inlineStr"><is><t>Revenue</t></is></c>')
    expect(xml).toContain('<c r="B2"><v>10.5</v></c>')
    expect(xml).toContain('<dimension ref="A1:B3"/>')
  })

  it('leaves a blank cell unwritten rather than writing an empty one', () => {
    expect(getPartText(made(), 'xl/worksheets/sheet1.xml')).toContain('<row r="1"><c r="B1"')
  })

  it('escapes what would otherwise end the element', () => {
    const pkg = newWorkbook([{ name: 'Sheet1', rows: [['R&D <1>']] }])
    expect(getPartText(pkg, 'xl/worksheets/sheet1.xml')).toContain('R&amp;D &lt;1&gt;')
  })

  it('reads back through the same reader that reads a real one', () => {
    const pkg = made()
    const sheet = openSheet(pkg, 'xl/worksheets/sheet1.xml')
    if (sheet === null) throw new Error('the part holds no worksheet')

    expect(readCell(sheet, 'B2', [])).toBe(10.5)
    expect(readCell(sheet, 'A3', [])).toBe('Q2')
    expect(sheetPath(pkg, 'Sheet1')).toBe('xl/worksheets/sheet1.xml')
  })
})

describe('emptying a cell', () => {
  it('takes the cell away rather than leaving it with no value', () => {
    // A `<c>` with no `<v>` is an empty string to some readers and nothing to
    // others; absent is the one form everybody agrees about.
    const xml = saved(workbook(), (sheet) => {
      clearCell(sheet, 'B2')
    })

    expect(xml).not.toContain('r="B2"')
    expect(xml).toContain('r="C2"')
  })

  it('leaves the row and its other cells where they were', () => {
    const xml = saved(workbook(), (sheet) => {
      clearCell(sheet, 'B2')
    })

    expect(xml).toContain('<row r="2" spans="1:3">')
    expect(xml).toContain('<c r="A2" s="1" t="s">')
  })

  it('says so when there was no such cell', () => {
    const sheet = opened(workbook())
    expect(clearCell(sheet, 'Z99')).toBe(false)
    expect(clearCell(sheet, 'nonsense')).toBe(false)
  })
})

describe('what a workbook says about itself', () => {
  const WORKBOOK_XML =
    '<workbook xmlns="x" xmlns:r="r"><workbookPr date1904="1"/>' +
    '<bookViews><workbookView activeTab="1"/></bookViews>' +
    '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/>' +
    '<sheet name="Working" sheetId="2" state="veryHidden" r:id="rId1"/></sheets>' +
    '<definedNames><definedName name="Rates">Data!$B$2:$B$9</definedName>' +
    '<definedName name="Local" localSheetId="0" hidden="1">Data!$A$1</definedName></definedNames>' +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'

  const workbook = () => {
    const pkg = { parts: new Map() }
    setPartText(pkg, 'xl/workbook.xml', WORKBOOK_XML)
    setPartText(pkg, 'xl/_rels/workbook.xml.rels', RELS)
    const read = readWorkbook(pkg)
    if (read === null) throw new Error('the part holds no workbook')
    return read
  }

  it('reads the date system, which decides what every date means', () => {
    expect(workbook().date1904).toBe(true)
  })

  it('reads which sheets are hidden, and how thoroughly', () => {
    // `veryHidden` is hidden from the menu that unhides things, which is how a
    // workbook keeps a working sheet out of sight.
    expect(workbook().sheets.map((sheet) => sheet.state)).toEqual(['visible', 'veryHidden'])
  })

  it('reads the sheet the workbook opens on', () => {
    expect(workbook().activeSheet).toBe(1)
  })

  it('reads the names and what they stand for', () => {
    expect(workbook().definedNames[0]).toEqual({
      name: 'Rates',
      formula: 'Data!$B$2:$B$9',
      sheet: null,
      hidden: false,
    })
  })

  it('keeps a name local to its sheet, because two can share a spelling', () => {
    expect(workbook().definedNames[1]).toMatchObject({ name: 'Local', sheet: 0, hidden: true })
  })

  it('reads the workbook asking to be recalculated before it is shown', () => {
    expect(workbook().fullCalcOnLoad).toBe(true)
  })
})
