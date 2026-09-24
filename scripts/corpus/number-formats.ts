import { readFile } from 'node:fs/promises'
import { ownFormula } from '../../apps/sheets/src/document/formula'
import { openWorkbook } from '../../apps/sheets/src/document/workbook'
import type { OpenWorkbook } from '../../apps/sheets/src/document/workbook'
import { parseReference } from '../../packages/ooxml-spreadsheet/src/reference'
import type { Cell } from '../../packages/ooxml-spreadsheet/src/cells'
import { FULL_ROOT, walk } from './lib'

/**
 * Where `tests/fixtures/number-formats.tsv` comes from.
 *
 * Apache POI keeps four workbooks that are nothing but a column of format
 * codes, a column of values, and a column of `TEXT(value, code)` carrying the
 * answer Excel cached when the file was last saved. They are, in other words,
 * exactly the table both our implementations of the format language are meant
 * to be judged by — written by the program we are copying rather than by us.
 *
 * This reads them out. It does not decide anything: a row is a value, a code
 * and what Excel put on screen, and a row this script cannot resolve is left
 * out rather than guessed at.
 *
 * Usage: pnpm corpus:formats [--corpus ~/corpus-full] [--out /tmp/matrix.tsv]
 */

/** `TEXT(C2, B2)` — the only shape these sheets use. */
const CALL = /^TEXT\(\s*(\$?[A-Z]{1,3}\$?\d+)\s*,\s*(\$?[A-Z]{1,3}\$?\d+)\s*\)$/u

/** The workbooks worth reading: POI's, by the names POI gives them. */
const WANTED = /NumberFormatTests|NumberFormatApproxTests|ElapsedFormatTests|GeneralFormatTests/u

export interface Row {
  /** The value as the file holds it: a number, or a quoted string. */
  value: string
  /** The format code, verbatim. */
  code: string
  /** What Excel shows, cached in the cell the formula is in. */
  expected: string
  /** Which workbook and which cell, so a surprising row can be looked up. */
  source: string
}

/** What a cell says, with the shared string table already looked through. */
function textOf(open: OpenWorkbook, cell: Cell): string {
  if (cell.type === 's') return open.strings[Number(cell.value)]?.text ?? ''
  if (cell.type === 'inlineStr') return cell.rich?.text ?? cell.value ?? ''
  return cell.value ?? ''
}

/** A value written the way the table writes it: numbers plain, text quoted. */
function valueOf(open: OpenWorkbook, cell: Cell): string | null {
  switch (cell.type) {
    case 'n':
    case undefined:
      return cell.value === undefined || cell.value === '' ? null : cell.value
    case 's':
    case 'str':
    case 'inlineStr':
      return JSON.stringify(textOf(open, cell))
    case 'b':
      // Quoted, because the table holds a value and a picture of it: what a
      // formula hands `TEXT` for a boolean is the word, and the word is what
      // the format language sees.
      return cell.value === '1' ? '"TRUE"' : '"FALSE"'
    default:
      // An error, or a date stored as text: not a value this table is about.
      return null
  }
}

async function rowsOf(path: string): Promise<Row[]> {
  const open = await openWorkbook(new Uint8Array(await readFile(path)), path)
  const name = path.split('/').pop() ?? path
  const rows: Row[] = []

  for (const sheet of open.sheets) {
    const at = (reference: string): Cell | undefined => {
      const position = parseReference(reference.replace(/\$/gu, ''))
      return position === null
        ? undefined
        : sheet.cells.rows.get(position.row)?.get(position.column)
    }

    for (const [, cells] of sheet.cells.rows) {
      for (const [, cell] of cells) {
        const call = CALL.exec((ownFormula(cell) ?? '').trim())
        if (call === null) continue

        const held = at(call[1] ?? '')
        const code = at(call[2] ?? '')
        if (held === undefined || code === undefined) continue

        const value = valueOf(open, held)
        if (value === null) continue

        rows.push({
          value,
          code: textOf(open, code),
          expected: textOf(open, cell),
          source: `${name} ${sheet.name}!${call[1] ?? ''}`,
        })
      }
    }
  }

  return rows
}

async function main(): Promise<void> {
  const argument = (flag: string, fallback: string): string => {
    const index = process.argv.indexOf(flag)
    return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
  }

  const root = argument('--corpus', FULL_ROOT)

  const files: string[] = []
  for await (const path of walk(root)) if (WANTED.test(path)) files.push(path)

  const rows: Row[] = []
  for (const file of files) rows.push(...(await rowsOf(file)))

  for (const row of rows) {
    process.stdout.write(`${row.value}\t${row.code}\t${row.expected}\t${row.source}\n`)
  }

  process.stderr.write(`${String(files.length)} workbooks, ${String(rows.length)} rows extracted\n`)
}

await main()
