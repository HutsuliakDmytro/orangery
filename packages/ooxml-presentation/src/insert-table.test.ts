import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { textOfBody, visibleCells } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { defaultTableStyle, insertTable } from './insert-table'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')
const box = { x: 914400, y: 914400, width: 7315200, height: 1828800 }

async function insert(name: string, rows: number, columns: number) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  const id = insertTable(pkg, slide, { rows, columns, transform: box })
  writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  return { id, shapes: reopened.slides[0]?.shapes ?? [] }
}

describe('defaultTableStyle', () => {
  it("takes the deck's own default rather than a fixed guid", async () => {
    // Hardcoding one would give every deck the same table whatever its theme.
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'table.pptx')))
    expect(defaultTableStyle(pkg)).toBe('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}')
  })
})

describe('inserting a table', () => {
  it('comes back as a graphic frame holding a table', async () => {
    const { shapes } = await insert('empty', 3, 4)
    const frame = shapes[0]

    expect(frame?.kind).toBe('graphicFrame')
    expect(frame?.graphic?.kind).toBe('table')
    expect(frame?.transform).toMatchObject(box)
  })

  it('makes every cell, because a missing one is a file PowerPoint refuses', async () => {
    const { shapes } = await insert('empty', 3, 4)
    const table = shapes[0]?.graphic?.table

    expect(table?.columns).toHaveLength(4)
    expect(table?.rows).toHaveLength(3)
    expect(table?.rows.map((row) => row.cells.length)).toEqual([4, 4, 4])
  })

  it('leaves the cells empty and drawable', async () => {
    const { shapes } = await insert('empty', 2, 2)
    const first = shapes[0]?.graphic?.table?.rows[0]

    expect(first?.cells.every((cell) => (cell.text ? textOfBody(cell.text) : '') === '')).toBe(true)
    expect(visibleCells(first ?? { height: null, cells: [], node: {} })).toHaveLength(2)
  })

  it('divides the box evenly between the columns and rows', async () => {
    const { shapes } = await insert('empty', 2, 4)
    const table = shapes[0]?.graphic?.table

    expect(table?.columns).toEqual([1828800, 1828800, 1828800, 1828800])
    expect(table?.rows.map((row) => row.height)).toEqual([914400, 914400])
  })

  it("takes the deck's table style", async () => {
    const { shapes } = await insert('table', 2, 2)
    expect(shapes[shapes.length - 1]?.graphic?.table?.properties.styleId).toBe(
      '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}',
    )
  })

  it('marks the first row as a header, which is what a new table looks like', async () => {
    const { shapes } = await insert('empty', 3, 3)
    expect(shapes[0]?.graphic?.table?.properties).toMatchObject({
      firstRow: true,
      bandedRows: true,
    })
  })

  it('refuses a table with no room to draw in', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    const slide = readDeck(pkg).slides[0]

    expect(
      slide === undefined
        ? null
        : insertTable(pkg, slide, { rows: 2, columns: 2, transform: { ...box, width: 0 } }),
    ).toBeNull()
  })

  it('never makes a table with no rows or columns', async () => {
    const { shapes } = await insert('empty', 0, 0)
    const table = shapes[0]?.graphic?.table

    expect(table?.columns).toHaveLength(1)
    expect(table?.rows).toHaveLength(1)
  })
})
