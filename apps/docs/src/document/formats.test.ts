import { describe, expect, it } from 'vitest'
import {
  definitionOf,
  displayNameOf,
  fileNameOf,
  formatFromPath,
  isPreserving,
  openFilters,
  UNTITLED_NAME,
} from './formats'

describe('formatFromPath', () => {
  it('recognises each supported extension', () => {
    expect(formatFromPath('/a/b.docx')).toBe('docx')
    expect(formatFromPath('/a/b.odt')).toBe('odt')
    expect(formatFromPath('/a/b.rtf')).toBe('rtf')
    expect(formatFromPath('/a/b.txt')).toBe('txt')
    expect(formatFromPath('/a/b.markdown')).toBe('md')
    expect(formatFromPath('/a/b.htm')).toBe('html')
  })

  it('ignores case', () => {
    expect(formatFromPath('/a/B.DOCX')).toBe('docx')
  })

  it('returns null for an unknown or missing extension', () => {
    expect(formatFromPath('/a/b.pages')).toBeNull()
    expect(formatFromPath('/a/noextension')).toBeNull()
  })

  it('uses the last extension for a multi-dotted name', () => {
    expect(formatFromPath('/a/report.final.docx')).toBe('docx')
  })
})

describe('preservation', () => {
  it('marks package formats as preserving', () => {
    expect(isPreserving('docx')).toBe(true)
    expect(isPreserving('odt')).toBe(true)
  })

  it('marks flat formats as lossy', () => {
    expect(isPreserving('txt')).toBe(false)
    expect(isPreserving('md')).toBe(false)
  })

  it('exposes a label for each format', () => {
    expect(definitionOf('docx').label).toBe('Word Document')
  })
})

describe('openFilters', () => {
  it('offers a combined filter first', () => {
    const filters = openFilters()
    expect(filters[0]?.name).toBe('All Documents')
    expect(filters[0]?.extensions).toContain('docx')
    expect(filters[0]?.extensions).toContain('md')
  })

  it('offers one filter per format after it', () => {
    expect(openFilters()).toHaveLength(7)
  })
})

describe('names', () => {
  it('takes the file name from a posix path', () => {
    expect(fileNameOf('/Users/x/report.docx')).toBe('report.docx')
  })

  it('takes the file name from a windows path', () => {
    expect(fileNameOf('C:\\Users\\x\\report.docx')).toBe('report.docx')
  })

  it('falls back to Untitled for an unsaved document', () => {
    expect(fileNameOf(null)).toBe(UNTITLED_NAME)
  })

  it('strips the extension for display', () => {
    expect(displayNameOf('/Users/x/report.docx')).toBe('report')
  })

  it('leaves a name without an extension alone', () => {
    expect(displayNameOf('/Users/x/report')).toBe('report')
  })
})
