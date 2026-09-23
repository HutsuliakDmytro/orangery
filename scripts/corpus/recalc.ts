import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { ownFormula } from '../../apps/sheets/src/document/formula'
import { openWorkbook } from '../../apps/sheets/src/document/workbook'
import type { OpenWorkbook } from '../../apps/sheets/src/document/workbook'
import { formatReference } from '../../packages/ooxml-spreadsheet/src/reference'
import type { Cell } from '../../packages/ooxml-spreadsheet/src/cells'
import { isOoxml, mapLimit, walk } from './lib'

/**
 * What the engine makes of a workbook, against what the file says it came to.
 *
 * Every `<f>` in a corpus workbook arrived with an `<v>` beside it: the answer
 * Excel got. Recalculating from the same cells and comparing is the only test
 * of the engine that uses somebody else's arithmetic rather than our own, and
 * the only one where being wrong is unambiguous.
 *
 * The engine is Rust and this is not, so the cells go out over a pipe to
 * `crates/formula/examples/corpus-recalc.rs` and the values come back.
 *
 * Usage: pnpm corpus:recalc [--corpus tests/fixtures/office] [--out corpus-recalc.json]
 */

/**
 * The engine, fed a script and asked for what it printed.
 *
 * Over a pipe rather than a file: a workbook of two hundred thousand cells is
 * a script of two hundred thousand lines, and writing each one to disk to have
 * it read straight back is the slowest part of the run.
 */
function ask(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(engine, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL')
    }, 60_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2000)
    })

    child.on('error', (error: Error) => {
      clearTimeout(watchdog)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(watchdog)
      if (code === 0) resolve(stdout)
      else reject(new Error(`engine exited with ${String(code)}: ${stderr.trim()}`))
    })

    child.stdin.on('error', () => {
      // The engine died before it read everything; `close` reports why.
    })
    child.stdin.end(input)
  })
}

function argumentValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const corpus = argumentValue('--corpus', join(process.cwd(), 'tests/fixtures/office'))
const out = argumentValue('--out', join(process.cwd(), 'corpus-recalc.json'))
const engine = join(process.cwd(), 'target/release/examples/corpus-recalc')

/**
 * Functions whose answer is allowed to differ.
 *
 * `NOW` and `RAND` are different every time by definition; `INDIRECT` and
 * `OFFSET` are not, but they reach cells through text the file's own writer
 * had a wider view of. A mismatch in any of these says nothing.
 */
const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|OFFSET|INDIRECT|INFO|CELL)\s*\(/iu

const escape = (text: string): string =>
  text.replace(/\\/gu, '\\\\').replace(/\t/gu, '\\t').replace(/\n/gu, '\\n')

const unescape = (text: string): string =>
  text.replace(/\\(.)/gu, (_, one: string) => (one === 't' ? '\t' : one === 'n' ? '\n' : one))

/** A cell as the engine's protocol states it: a kind and a payload. */
function stated(open: OpenWorkbook, cell: Cell): { kind: string; payload: string } {
  const value = cell.value ?? ''

  switch (cell.type) {
    case 's': {
      const index = Number(value)
      return { kind: 's', payload: escape(open.strings[index]?.text ?? '') }
    }
    case 'inlineStr':
      return { kind: 's', payload: escape(cell.rich?.text ?? value) }
    case 'str':
      return { kind: 's', payload: escape(value) }
    case 'b':
      return { kind: 'b', payload: value === '1' ? '1' : '0' }
    case 'e':
      return { kind: 'e', payload: value }
    case 'd':
      // A date written as text rather than as a serial; the engine works in
      // serials, so this is not a number it could be asked to match.
      return { kind: 'z', payload: '' }
    default:
      return value === '' ? { kind: 'z', payload: '' } : { kind: 'n', payload: value }
  }
}

interface Mismatch {
  file: string
  /** Why it is not comparable, when it is not: a macro, or a spilled range. */
  excused: string | null
  sheet: string
  reference: string
  formula: string
  /** What the file's own writer worked it out to. */
  expected: string
  ours: string
  functions: string[]
}

interface Outcome {
  file: string
  cells: number
  compared: number
  matched: number
  unparsed: number
  skipped: number
  /** Answers that differ for a reason that is not the engine's arithmetic. */
  excused: number
  mismatches: Mismatch[]
  excuses: Mismatch[]
  error: string | null
}

/**
 * Whether a difference is the engine's fault.
 *
 * Two are not. A workbook with macros can call a function that lives in the
 * macros, and no engine that does not run VBA will ever agree about it. And a
 * dynamic array's answer is stored in the file across the cells it spilled
 * into, so loading those cached values back fills the very cells the formula
 * needs to spill into — the `#SPILL!` is this harness's doing, not the
 * engine's.
 */
function excuse(
  formula: string,
  kind: string,
  payload: string,
  macros: boolean,
  arrays: boolean,
): string | null {
  if (macros && kind === 'e' && payload === '#NAME?') return 'a function defined in the macros'
  if (arrays && kind === 'e' && payload === '#SPILL!') return 'spilled into its own cached answer'
  if (arrays && /^_xlfn\./u.test(formula)) return 'a dynamic array read back from its own answer'
  // `SUBTOTAL(1xx)` and `AGGREGATE` leave out the rows a filter has hidden,
  // and this harness never tells the engine which rows those are.
  if (/\b(SUBTOTAL\s*\(\s*1[0-9]{2}|AGGREGATE\s*\()/iu.test(formula))
    return 'depends on which rows are hidden, which the harness does not send'
  return null
}

const functionsIn = (text: string): string[] => [
  ...new Set([...text.matchAll(/([A-Z][A-Z0-9._]*)\s*\(/gu)].map((match) => match[1] ?? '')),
]

/** Whether two answers are the same answer, given one came back through a double. */
function same(expected: { kind: string; payload: string }, kind: string, payload: string): boolean {
  if (expected.kind === 'n' && kind === 'n') {
    const a = Number(expected.payload)
    const b = Number(payload)
    if (Number.isNaN(a) || Number.isNaN(b)) return expected.payload === payload
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  }

  // A file that stored a formula's answer as a shared string and an engine that
  // says text are saying the same thing.
  if ((expected.kind === 's' || expected.kind === 'z') && (kind === 's' || kind === 'z')) {
    return unescape(expected.payload).trim() === unescape(payload).trim()
  }

  if (expected.kind === 'z' && kind === 'n') return Number(payload) === 0
  if (expected.kind === 'n' && kind === 'z') return Number(expected.payload) === 0

  return expected.kind === kind && expected.payload === payload
}

async function recalculate(file: string): Promise<Outcome> {
  const outcome: Outcome = {
    file,
    cells: 0,
    compared: 0,
    matched: 0,
    unparsed: 0,
    skipped: 0,
    excused: 0,
    mismatches: [],
    excuses: [],
    error: null,
  }

  let open: OpenWorkbook
  try {
    open = await openWorkbook(new Uint8Array(await readFile(file)))
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error)
    return outcome
  }

  const macros = [...open.pkg.parts.keys()].some((part) => part.endsWith('vbaProject.bin'))
  const arrays = open.pkg.parts.has('xl/metadata.xml')

  const lines: string[] = [
    `moment\t${String(45_000)}`,
    `date1904\t${open.workbook.date1904 ? '1' : '0'}`,
  ]

  // Sheet-local names go over as well, because the engine has one namespace
  // and a formula that cannot find a name gets `#REF!` — which would be
  // reported as an engine fault when it is a name this harness never sent.
  for (const name of open.workbook.definedNames) {
    // `_xlnm.Print_Area` and its kind are settings written as names; the app
    // leaves them out of the engine and so does this.
    if (name.hidden || name.name.startsWith('_xlnm.')) continue
    lines.push(`name\t${escape(name.name)}\t${escape(name.formula)}`)
  }

  // Structured references — `tblExpenses[Amount]` — are resolved against the
  // tables, and an engine that was never told about them answers `#REF!`.
  for (const sheet of open.sheets) {
    for (const table of sheet.tables) {
      const rows = [table.range.from.row, table.range.to.row]
      const columns = [table.range.from.column, table.range.to.column]
      lines.push(
        [
          'table',
          escape(table.name),
          escape(sheet.name),
          Math.min(...rows),
          Math.max(...rows),
          Math.min(...columns),
          Math.max(...columns),
          table.headerRows,
          table.totalsRows,
          ...table.columns.map((column) => escape(column.name)),
        ].join('\t'),
      )
    }
  }

  const asked: {
    sheet: string
    row: number
    column: number
    cell: Cell
    expected: ReturnType<typeof stated>
  }[] = []

  for (const sheet of open.sheets) {
    for (const [, cells] of sheet.cells.rows) {
      for (const [, cell] of cells) {
        outcome.cells += 1
        const expected = stated(open, cell)
        // The same rule the app uses: the cells under an array formula carry
        // its text so anything can ask them what their formula is, but only
        // the corner computes it.
        const formula = ownFormula(cell) ?? ''

        if (formula === '') {
          lines.push(
            `value\t${escape(sheet.name)}\t${String(cell.row)}\t${String(cell.column)}\t${expected.kind}\t${expected.payload}`,
          )
          continue
        }

        // An array formula — `t="array"`, or a cell carrying `cm="1"` —
        // means its ranges whole; anything else means the implicit
        // intersection every file written before dynamic arrays meant.
        const array =
          cell.formula?.kind === 'array' || cell.carried?.['cm'] !== undefined ? '1' : '0'

        lines.push(
          `formula\t${escape(sheet.name)}\t${String(cell.row)}\t${String(cell.column)}\t${escape(formula)}\t${expected.kind}\t${expected.payload}\t${array}`,
        )

        // A formula that reaches into another workbook is answered from a file
        // we do not have; a volatile one is a different answer every time.
        if (VOLATILE.test(formula) || formula.includes('[') || cell.type === 'd') {
          outcome.skipped += 1
          continue
        }

        asked.push({ sheet: sheet.name, row: cell.row, column: cell.column, cell, expected })
      }
    }
  }

  if (asked.length === 0) return outcome

  lines.push('recalc')
  for (const one of asked) {
    lines.push(`get\t${escape(one.sheet)}\t${String(one.row)}\t${String(one.column)}`)
  }

  let stdout: string
  try {
    stdout = await ask(`${lines.join('\n')}\n`)
  } catch (error) {
    outcome.error = error instanceof Error ? error.message.slice(0, 300) : String(error)
    return outcome
  }

  const answers = stdout.split('\n').filter((line) => line !== '')
  const values = answers.filter((line) => !line.startsWith('unparsed\t'))
  outcome.unparsed = answers.length - values.length

  for (const [index, one] of asked.entries()) {
    const answer = values[index]
    if (answer === undefined) break

    const [kind = 'z', payload = ''] = answer.split('\t')
    outcome.compared += 1

    if (same(one.expected, kind, payload)) {
      outcome.matched += 1
      continue
    }

    const formula = one.cell.formula?.text ?? ''
    const excused = excuse(formula, kind, payload, macros, arrays)
    if (excused !== null) outcome.excused += 1

    const mismatch = {
      excused,
      file: file.split('/').pop() ?? file,
      sheet: one.sheet,
      reference: formatReference({ row: one.row, column: one.column }),
      formula,
      expected: `${one.expected.kind}:${unescape(one.expected.payload)}`,
      ours: `${kind}:${unescape(payload)}`,
      functions: functionsIn(formula),
    }

    if (excused === null) outcome.mismatches.push(mismatch)
    else outcome.excuses.push(mismatch)
  }

  return outcome
}

const files: string[] = []
for await (const path of walk(corpus)) {
  const extension = extname(path).toLowerCase()
  if (isOoxml(extension) && /^\.xl/u.test(extension)) files.push(path)
}
files.sort()

console.log(`${String(files.length)} workbooks under ${corpus}`)

const outcomes = await mapLimit(files, 4, async (file) => {
  const outcome = await recalculate(file)
  if (outcome.compared > 0 || outcome.error !== null) {
    console.log(
      `  ${outcome.mismatches.length === 0 && outcome.error === null ? 'ok  ' : 'MISS'} ${file.split('/').pop() ?? ''} — ${String(outcome.matched)}/${String(outcome.compared)} matched${outcome.error === null ? '' : `, ${outcome.error.split('\n')[0] ?? ''}`}`,
    )
  }
  return outcome
})

const withFormulas = outcomes.filter((one) => one.compared > 0)
const mismatches = outcomes.flatMap((one) => one.mismatches)

await writeFile(
  out,
  `${JSON.stringify(
    {
      generated: new Date().toISOString(),
      corpus,
      summary: {
        workbooks: files.length,
        withFormulas: withFormulas.length,
        compared: outcomes.reduce((sum, one) => sum + one.compared, 0),
        matched: outcomes.reduce((sum, one) => sum + one.matched, 0),
        mismatched: mismatches.length,
        excused: outcomes.reduce((sum, one) => sum + one.excused, 0),
        unparsed: outcomes.reduce((sum, one) => sum + one.unparsed, 0),
        skipped: outcomes.reduce((sum, one) => sum + one.skipped, 0),
        failedToOpen: outcomes.filter((one) => one.error !== null).length,
      },
      outcomes,
    },
    null,
    1,
  )}\n`,
)

const compared = outcomes.reduce((sum, one) => sum + one.compared, 0)
const matched = outcomes.reduce((sum, one) => sum + one.matched, 0)

console.log(`\n${out}`)
console.log(
  `${String(withFormulas.length)} workbooks with formulas, ${String(compared)} cells compared, ${String(matched)} matched, ${String(mismatches.length)} not`,
)

const byFunction = new Map<string, number>()
for (const mismatch of mismatches) {
  for (const name of mismatch.functions.length === 0 ? ['(no function)'] : mismatch.functions) {
    byFunction.set(name, (byFunction.get(name) ?? 0) + 1)
  }
}

if (byFunction.size > 0) {
  console.log('\nMismatches by function:')
  for (const [name, count] of [...byFunction].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${name.padEnd(18)} ${String(count)}`)
  }
  console.log('\nFirst few:')
  for (const mismatch of mismatches.slice(0, 10)) {
    console.log(
      `  ${mismatch.file} ${mismatch.sheet}!${mismatch.reference}  ${mismatch.formula.slice(0, 60)}  Excel ${mismatch.expected.slice(0, 30)} · us ${mismatch.ours.slice(0, 30)}`,
    )
  }
}
