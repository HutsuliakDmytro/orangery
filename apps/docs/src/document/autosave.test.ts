import { describe, expect, it } from 'vitest'
import { AUTOSAVE_INTERVAL_MS, buildSnapshot, parseSnapshot } from './autosave'

const doc = { type: 'doc', content: [{ type: 'paragraph' }] }

describe('buildSnapshot', () => {
  it('stamps the schema version', () => {
    expect(buildSnapshot('/a/b.docx', doc).version).toBe(1)
  })

  it('records the source path', () => {
    expect(buildSnapshot('/a/b.docx', doc).path).toBe('/a/b.docx')
  })

  it('allows a document that was never saved', () => {
    expect(buildSnapshot(null, doc).path).toBeNull()
  })

  it('records an ISO timestamp', () => {
    expect(() => new Date(buildSnapshot(null, doc).savedAt).toISOString()).not.toThrow()
  })
})

describe('parseSnapshot', () => {
  it('round-trips a snapshot it wrote', () => {
    const snapshot = buildSnapshot('/a/b.docx', doc)
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseSnapshot('not json')).toBeNull()
  })

  it('rejects a snapshot from an unknown schema version', () => {
    expect(parseSnapshot(JSON.stringify({ version: 99, doc, savedAt: 'x' }))).toBeNull()
  })

  it('rejects a snapshot with no document', () => {
    expect(parseSnapshot(JSON.stringify({ version: 1, savedAt: 'x' }))).toBeNull()
  })

  it('rejects a bare value', () => {
    expect(parseSnapshot('null')).toBeNull()
    expect(parseSnapshot('42')).toBeNull()
  })

  it('rejects a document that is an array rather than a node', () => {
    expect(parseSnapshot(JSON.stringify({ version: 1, doc: [], savedAt: 'x' }))).toBeNull()
  })

  it('rejects a document that is null', () => {
    expect(parseSnapshot(JSON.stringify({ version: 1, doc: null, savedAt: 'x' }))).toBeNull()
  })

  it('normalises a missing path to null', () => {
    const parsed = parseSnapshot(JSON.stringify({ version: 1, doc, savedAt: 'x' }))
    expect(parsed?.path).toBeNull()
  })
})

describe('interval', () => {
  it('matches the five seconds CLAUDE.md specifies', () => {
    expect(AUTOSAVE_INTERVAL_MS).toBe(5000)
  })
})
