import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_PAGE } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from '../document/workbook'
import type { OpenWorkbook } from '../document/workbook'
import { PrintView } from './print-view'

/**
 * The sheet as a printer sees it.
 *
 * A table of HTML rather than the canvas, because the canvas holds the cells
 * somebody is looking at and printing wants the ones they are not.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let workbook: OpenWorkbook

beforeAll(async () => {
  workbook = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
})

afterEach(cleanup)

const shown = (setup = DEFAULT_PAGE) => {
  const sheet = workbook.sheets[0]
  if (sheet === undefined) throw new Error('the fixture has no sheets')

  render(<PrintView open={workbook} sheet={sheet} setup={setup} />)
  return screen.getByRole('table')
}

describe('printing a sheet', () => {
  it('writes out the cells, formatted as the sheet shows them', () => {
    const table = shown()

    expect(table.querySelectorAll('tr').length).toBeGreaterThan(1)
    expect(table.textContent).toContain('January')
  })

  it('repeats the rows the workbook asks to repeat', () => {
    // In a `<thead>`, because that is how a browser is told to put them at
    // the top of every page — the one piece of pagination we get for free.
    workbook.workbook.definedNames = [
      { name: '_xlnm.Print_Titles', formula: 'Budget!$1:$1', sheet: 0, hidden: false },
    ]

    const table = shown()
    expect(table.querySelectorAll('thead tr')).toHaveLength(1)

    workbook.workbook.definedNames = []
  })

  it('draws no gridlines unless the sheet asks for them', () => {
    // The setting people forget they have not set.
    expect(shown().querySelector('td')?.style.border).toBe('')
  })

  it('draws them where it does', () => {
    expect(shown({ ...DEFAULT_PAGE, gridLines: true }).querySelector('td')?.style.border).toContain(
      'solid',
    )
  })

  it('is hidden on screen, because it is not for the screen', () => {
    shown()
    expect(screen.getByTestId('print-view').className).toContain('hidden')
  })
})
