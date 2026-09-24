import { readFile } from 'node:fs/promises'
import { openWorkbook } from '../../apps/sheets/src/document/workbook'
import { parseReference } from '../../packages/ooxml-spreadsheet/src/reference'

/** What a range of a corpus workbook actually holds, for reading a mismatch. */
const [path = '', sheetName = '', ...ranges] = process.argv.slice(2)
const open = await openWorkbook(new Uint8Array(await readFile(path)), path)
const sheet = open.sheets.find((one) => one.name === sheetName) ?? open.sheets[0]

for (const range of ranges) {
  const [from = '', to = from] = range.split(':')
  const start = parseReference(from)
  const end = parseReference(to)
  if (start === null || end === null) continue
  const found: number[] = []
  for (let row = start.row; row <= end.row; row += 1) {
    for (let column = start.column; column <= end.column; column += 1) {
      const cell = sheet?.cells.rows.get(row)?.get(column)
      if (cell?.value !== undefined && cell.type !== 's') found.push(Number(cell.value))
    }
  }
  const total = found.reduce((sum, one) => sum + one, 0)
  const largest = found.reduce((big, one) => Math.max(big, Math.abs(one)), 0)
  process.stdout.write(
    `${range}\tn=${String(found.length)}\ttotal=${String(total)}\tlargest=${String(largest)}\n`,
  )
  process.stdout.write(`  ${found.slice(0, 20).join(', ')}\n`)
}
