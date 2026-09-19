import { describe, expect, it } from 'vitest'
import { setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { readSheetComments, readNotes, readThreads, readPeople } from './comments'
import { readTable, readTables, tableAt } from './tables'

/**
 * The two things a sheet holds beside its cells: tables and what people said
 * about them.
 */

const TABLE =
  '<table xmlns="x" id="1" name="Budget" displayName="Budget" ref="A1:C11" totalsRowCount="1">' +
  '<autoFilter ref="A1:C10"/>' +
  '<tableColumns count="3">' +
  '<tableColumn id="1" name="Month"/>' +
  '<tableColumn id="2" name="Planned" totalsRowFunction="sum"/>' +
  '<tableColumn id="3" name="Spent" totalsRowFunction="sum">' +
  '<calculatedColumnFormula>Budget[[#This Row],[Planned]]*0.9</calculatedColumnFormula>' +
  '</tableColumn></tableColumns>' +
  '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" ' +
  'showRowStripes="1" showColumnStripes="0"/></table>'

const table = () => {
  const read = readTable(TABLE)
  if (read === null) throw new Error('the part holds no table')
  return read
}

describe('a table', () => {
  it('reads the name a formula calls it by', () => {
    expect(table().name).toBe('Budget')
    expect(table().range.to).toEqual({ row: 10, column: 2 })
  })

  it('reads its columns, which are what a structured reference names', () => {
    expect(table().columns.map((column) => column.name)).toEqual(['Month', 'Planned', 'Spent'])
  })

  it('reads the formula a calculated column carries', () => {
    expect(table().columns[2]?.formula).toBe('Budget[[#This Row],[Planned]]*0.9')
  })

  it('reads what the totals row does with each column', () => {
    expect(table().columns[1]?.totalsFunction).toBe('sum')
    expect(table().columns[0]?.totalsFunction).toBeNull()
    expect(table().totalsRows).toBe(1)
  })

  it('assumes a header row, because a table has one unless it says otherwise', () => {
    expect(table().headerRows).toBe(1)
    expect(readTable(TABLE.replace('totalsRowCount="1"', 'headerRowCount="0"'))?.headerRows).toBe(0)
  })

  it('reads the style and its stripes', () => {
    expect(table().style).toEqual({
      name: 'TableStyleMedium2',
      firstColumn: false,
      lastColumn: false,
      rowStripes: true,
      columnStripes: false,
    })
  })

  it('knows it carries filter arrows', () => {
    expect(table().filtered).toBe(true)
  })

  it('finds the table a cell falls inside, and nothing for one that does not', () => {
    const tables = [table()]

    expect(tableAt(tables, { row: 3, column: 1 })?.name).toBe('Budget')
    expect(tableAt(tables, { row: 30, column: 1 })).toBeNull()
  })

  it('reads every table of a package, in the order they are numbered', () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'xl/tables/table1.xml', TABLE)
    setPartText(pkg, 'xl/tables/table2.xml', TABLE.replace('name="Budget"', 'name="Actuals"'))
    setPartText(pkg, 'xl/worksheets/sheet1.xml', '<worksheet/>')

    expect(readTables(pkg).map((one) => one.name)).toEqual(['Budget', 'Actuals'])
  })

  it('is nothing where the part is not a table', () => {
    expect(readTable('<worksheet/>')).toBeNull()
    expect(readTable('<table ref="nonsense"/>')).toBeNull()
  })
})

const NOTES =
  '<comments xmlns="x"><authors><author>Dmytro</author><author>Anna</author></authors>' +
  '<commentList><comment ref="B7" authorId="1"><text><r><t>Check this</t></r>' +
  '<r><t> twice</t></r></text></comment>' +
  '<comment ref="C2" authorId="0"><text><t>Approved</t></text></comment></commentList></comments>'

const THREADS =
  '<ThreadedComments xmlns="x">' +
  '<threadedComment ref="B7" dT="2026-09-19T10:00:00Z" personId="{P1}" id="{C1}">' +
  '<text>Check this twice</text></threadedComment>' +
  '<threadedComment ref="B7" dT="2026-09-19T11:00:00Z" personId="{P2}" parentId="{C1}" done="1">' +
  '<text>Checked</text></threadedComment></ThreadedComments>'

const PEOPLE =
  '<personList xmlns="x"><person displayName="Dmytro" id="{P1}"/>' +
  '<person displayName="Anna" id="{P2}"/></personList>'

describe('what people said about the cells', () => {
  it('reads a note with its author and all of its words', () => {
    // A note can be formatted, so its text is runs; the words are all of them.
    expect(readNotes(NOTES)[0]).toEqual({ cell: 'B7', author: 'Anna', text: 'Check this twice' })
  })

  it('reads every note of the part', () => {
    expect(readNotes(NOTES).map((note) => note.cell)).toEqual(['B7', 'C2'])
  })

  it('gathers a thread and its replies onto the cell they are about', () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'xl/persons/person.xml', PEOPLE)

    const threads = readThreads(THREADS, readPeople(pkg))

    expect(threads).toHaveLength(1)
    expect(threads[0]?.comments.map((one) => one.author)).toEqual(['Dmytro', 'Anna'])
    expect(threads[0]?.comments[1]?.text).toBe('Checked')
  })

  it('knows a thread somebody marked as resolved', () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'xl/persons/person.xml', PEOPLE)

    expect(readThreads(THREADS, readPeople(pkg))[0]?.resolved).toBe(true)
  })

  it('keeps the date each reply was written, as the file states it', () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'xl/persons/person.xml', PEOPLE)

    expect(readThreads(THREADS, readPeople(pkg))[0]?.comments[0]?.date).toBe('2026-09-19T10:00:00Z')
  })

  it('reads both kinds, because Excel writes both', () => {
    // The note is the fallback for older readers; a reader that took only it
    // would turn a conversation into its first line.
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'xl/persons/person.xml', PEOPLE)
    setPartText(pkg, 'xl/comments1.xml', NOTES)
    setPartText(pkg, 'xl/threadedComments/threadedComment1.xml', THREADS)

    const comments = readSheetComments(
      pkg,
      'xl/comments1.xml',
      'xl/threadedComments/threadedComment1.xml',
    )

    expect(comments.threads).toHaveLength(1)
    expect(comments.notes).toHaveLength(2)
  })

  it('answers with nothing for a sheet that has neither', () => {
    expect(readSheetComments({ parts: new Map() }, null, null)).toEqual({ threads: [], notes: [] })
  })
})
