import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSnapshot, parseSnapshot } from './autosave'
import { openWorkbook } from './workbook'

/**
 * The copy a crash cannot reach.
 *
 * A snapshot is a cache and never a format, so the only promises worth making
 * about it are that a workbook survives the round trip and that anything which
 * is not one of ours is refused. Half a file recovered is worse than an
 * admitted loss.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let bytes: Uint8Array

beforeEach(async () => {
  bytes = new Uint8Array(await readFile(FIXTURE))
})

describe('a snapshot of a workbook', () => {
  it('gives the same bytes back', async () => {
    const parsed = parseSnapshot(JSON.stringify(buildSnapshot('/books/budget.xlsx', bytes)))

    expect(parsed?.bytes).toEqual(bytes)
    // And they are still a workbook, which is the point of keeping them.
    expect((await openWorkbook(parsed?.bytes ?? new Uint8Array())).sheets).toHaveLength(3)
  })

  it('remembers where the workbook came from', () => {
    const parsed = parseSnapshot(JSON.stringify(buildSnapshot('/books/budget.xlsx', bytes)))
    expect(parsed?.snapshot.path).toBe('/books/budget.xlsx')
  })

  it('remembers that a workbook came from nowhere', () => {
    // Which is how it comes back with no path and asks where to save.
    const parsed = parseSnapshot(JSON.stringify(buildSnapshot(null, bytes)))
    expect(parsed?.snapshot.path).toBeNull()
  })

  it('says when it was taken, for the offer to be worth reading', () => {
    const parsed = parseSnapshot(JSON.stringify(buildSnapshot(null, bytes)))
    expect(Date.parse(parsed?.snapshot.savedAt ?? '')).not.toBeNaN()
  })
})

describe('what is refused', () => {
  it('refuses something that is not JSON at all', () => {
    expect(parseSnapshot('half a file, because the power went')).toBeNull()
  })

  it('refuses a snapshot from a build that wrote them differently', () => {
    expect(parseSnapshot(JSON.stringify({ version: 2, workbook: 'x', savedAt: 'now' }))).toBeNull()
  })

  it('refuses one with nothing in it', () => {
    expect(
      parseSnapshot(JSON.stringify({ version: 1, workbook: '', savedAt: 'now', path: null })),
    ).toBeNull()
  })

  it('refuses one whose workbook is not text it can decode', () => {
    expect(
      parseSnapshot(JSON.stringify({ version: 1, workbook: 'not base64 ≠', savedAt: 'now' })),
    ).toBeNull()
  })

  it('refuses one that lost its date', () => {
    expect(parseSnapshot(JSON.stringify({ version: 1, workbook: 'AAAA' }))).toBeNull()
  })
})
