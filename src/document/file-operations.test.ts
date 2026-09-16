import { describe, expect, it } from 'vitest'
import {
  ensureExtension,
  openDocumentFrom,
  saveDocumentTo,
  UnsupportedFormatError,
} from './file-operations'

describe('ensureExtension', () => {
  it('appends the extension when the user typed a bare name', () => {
    expect(ensureExtension('/a/report', 'docx')).toBe('/a/report.docx')
  })

  it('leaves a path that already has a known extension alone', () => {
    expect(ensureExtension('/a/report.docx', 'docx')).toBe('/a/report.docx')
  })

  it('leaves an unrelated extension alone rather than doubling up', () => {
    expect(ensureExtension('/a/report.txt', 'txt')).toBe('/a/report.txt')
  })
})

describe('openDocumentFrom', () => {
  it('rejects an unrecognised file type before touching the disk', async () => {
    await expect(openDocumentFrom('/a/b.pages')).rejects.toBeInstanceOf(UnsupportedFormatError)
    await expect(openDocumentFrom('/a/b.pages')).rejects.toThrow(/does not recognise/)
  })

  it('rejects a file with no extension at all', async () => {
    await expect(openDocumentFrom('/a/plainfile')).rejects.toBeInstanceOf(UnsupportedFormatError)
  })
})

describe('saveDocumentTo', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph' }] }

  it('rejects a target whose type it does not recognise', async () => {
    await expect(
      saveDocumentTo({ kind: 'flat', format: 'txt' }, doc, '/a/b.pages'),
    ).rejects.toBeInstanceOf(UnsupportedFormatError)
  })

  it('refuses to save a flat document as DOCX, which has no package to write', async () => {
    await expect(saveDocumentTo({ kind: 'flat', format: 'txt' }, doc, '/a/b.docx')).rejects.toThrow(
      /not supported/,
    )
  })
})
