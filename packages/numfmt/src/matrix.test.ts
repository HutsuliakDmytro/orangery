import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatValue } from './format'

/**
 * The table this package is judged by.
 *
 * It is not in this file. `tests/fixtures/number-formats.tsv` holds it, and
 * the Rust half of this language — `crates/formula/src/numfmt`, which `TEXT`
 * uses in the middle of a recalculation — is tested against the same rows.
 * Two implementations exist because the grid formats every visible cell while
 * it draws it, in the window, and neither side can call the other without
 * crossing a process boundary per cell. Two implementations of one language
 * drift unless something holds them together; this is the something.
 *
 * Every row is a value, a format code and what Excel shows for the two of
 * them. Not what we think is reasonable — what the program the file came from
 * puts on screen, because a format is right when the cell looks like it
 * looked before we opened it.
 */

const TABLE = join(process.cwd(), '../../tests/fixtures/number-formats.tsv')

interface Row {
  group: string
  value: number | string
  code: string
  expected: string
}

function table(): Row[] {
  const rows: Row[] = []
  let group = 'ungrouped'

  for (const line of readFileSync(TABLE, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    if (line.startsWith('#')) {
      // A heading is a comment with one word after the hash; the block of
      // explanation at the top has more.
      const said = line.slice(1).trim()
      if (said !== '' && !said.includes('\t')) group = said
      continue
    }

    const [value = '', code = '', expected = ''] = line.split('\t')
    rows.push({
      group,
      value: value.startsWith('"') ? value.slice(1, -1) : Number(value),
      code,
      expected,
    })
  }

  return rows
}

const rows = table()

describe('the shared table of formats', () => {
  it('is there, and has rows in it', () => {
    // A path that has moved would otherwise make this file pass by testing
    // nothing at all.
    expect(rows.length).toBeGreaterThan(90)
  })

  it.each(rows.map((row) => [row.group, row.value, row.code, row.expected] as const))(
    '%s: %s through %s is "%s"',
    (_group, value, code, expected) => {
      expect(formatValue(value, code).text).toBe(expected)
    },
  )
})
