import { describe, expect, it } from 'vitest'
import { parseFontTable } from './font-table'

describe('parseFontTable', () => {
  it('lists every family the document declares', () => {
    const xml = '<w:fonts xmlns:w="x"><w:font w:name="Calibri"/><w:font w:name="Symbol"/></w:fonts>'
    expect(parseFontTable(xml)).toEqual(['Calibri', 'Symbol'])
  })

  it('returns an empty list for malformed input', () => {
    expect(parseFontTable('<nope/>')).toEqual([])
  })
})
