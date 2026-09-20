import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import { applyLook } from './edit'
import { blankWorkbook } from './new'
import { workbookBytes } from './save'
import { openWorkbook } from './workbook'

/**
 * A workbook made from nothing.
 *
 * The test worth having is not that the bytes exist but that they are a
 * workbook somebody can work in: one sheet to type into, and a styles part to
 * put a look in — without which the toolbar has nothing to point a cell at
 * and a new file could be typed in and never formatted.
 */

describe('an empty workbook', () => {
  it('opens, with one sheet and no cells', async () => {
    const open = await openWorkbook(await blankWorkbook())

    expect(open.sheets).toHaveLength(1)
    expect(open.sheets[0]?.cells.rows.size).toBe(0)
  })

  it('has somewhere to put a look', async () => {
    const open = await openWorkbook(await blankWorkbook())
    const sheet = open.sheets[0]
    if (sheet === undefined) throw new Error('the workbook has no sheet')

    const changes = applyLook(open, sheet, [{ row: 0, column: 0 }], { font: { bold: true } })
    expect(changes).toHaveLength(1)
  })

  it('declares the part it carries, or Excel offers to repair it', async () => {
    const pkg = await readPackage(await blankWorkbook(), 'xl/workbook.xml')

    expect(getPartText(pkg, '[Content_Types].xml')).toContain('/xl/styles.xml')
    expect(getPartText(pkg, 'xl/_rels/workbook.xml.rels')).toContain('styles.xml')
  })

  it('has the two fills Excel insists on', async () => {
    // Nobody knows why the second must be `gray125` any more; a file without
    // it is one Excel offers to repair.
    const pkg = await readPackage(await blankWorkbook(), 'xl/workbook.xml')
    expect(getPartText(pkg, 'xl/styles.xml')).toContain('gray125')
  })

  it('can be typed in, saved and opened again', async () => {
    const open = await openWorkbook(await blankWorkbook())
    const sheet = open.sheets[0]
    if (sheet === undefined) throw new Error('the workbook has no sheet')

    applyLook(open, sheet, [{ row: 0, column: 0 }], { font: { bold: true } })
    const again = await openWorkbook(await workbookBytes(open, { edited: true }))

    expect(again.sheets[0]?.cells.rows.get(0)?.get(0)).not.toBeUndefined()
  })
})

describe('a workbook with macros in it', () => {
  const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/macros.xlsm')

  it('opens like any other', async () => {
    const open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
    expect(open.sheets).toHaveLength(3)
  })

  it('keeps the project byte for byte through a save', async () => {
    // Never parsed, never run, never lost — which is the whole promise.
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const before = await readPackage(bytes, 'xl/workbook.xml')

    const open = await openWorkbook(bytes)
    const after = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')

    expect(after.parts.get('xl/vbaProject.bin')?.bytes).toEqual(
      before.parts.get('xl/vbaProject.bin')?.bytes,
    )
  })
})
