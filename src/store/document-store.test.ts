import { beforeEach, describe, expect, it } from 'vitest'
import { documentFileName, uniqueWarnings, useDocumentStore, windowTitle } from './document-store'

const reset = () => {
  useDocumentStore.getState().newDocument()
  useDocumentStore.setState({ busy: false })
}

beforeEach(reset)

describe('lifecycle', () => {
  it('starts as an unsaved, clean document', () => {
    const state = useDocumentStore.getState()
    expect(state.path).toBeNull()
    expect(state.dirty).toBe(false)
    expect(state.warnings).toEqual([])
  })

  it('marks the document dirty on edit', () => {
    useDocumentStore.getState().markDirty()
    expect(useDocumentStore.getState().dirty).toBe(true)
  })

  it('does not churn state when already dirty', () => {
    useDocumentStore.getState().markDirty()
    const before = useDocumentStore.getState()
    useDocumentStore.getState().markDirty()
    expect(useDocumentStore.getState()).toBe(before)
  })

  it('clears dirty and records the path on save', () => {
    useDocumentStore.getState().markDirty()
    useDocumentStore.getState().markSaved('/a/b.docx', 'docx')

    const state = useDocumentStore.getState()
    expect(state.dirty).toBe(false)
    expect(state.path).toBe('/a/b.docx')
    expect(state.lastSaved).toBeInstanceOf(Date)
  })

  it('treats a freshly opened document as clean', () => {
    useDocumentStore.getState().markDirty()
    useDocumentStore.getState().openDocument({ path: '/a/b.docx', format: 'docx', warnings: [] })
    expect(useDocumentStore.getState().dirty).toBe(false)
  })

  it('gives each opened document a new session id', () => {
    const first = useDocumentStore.getState().sessionId
    useDocumentStore.getState().openDocument({ path: '/a/b.docx', format: 'docx', warnings: [] })
    expect(useDocumentStore.getState().sessionId).not.toBe(first)
  })
})

describe('warnings', () => {
  it('carries warnings from the opened document', () => {
    useDocumentStore.getState().openDocument({
      path: '/a/b.docx',
      format: 'docx',
      warnings: [{ tag: 'w:tbl', message: 'tables' }],
    })
    expect(useDocumentStore.getState().warnings).toHaveLength(1)
  })

  it('stays dismissed until something new arrives', () => {
    useDocumentStore.getState().addWarnings([{ tag: 'w:tbl', message: 'tables' }])
    useDocumentStore.getState().dismissWarnings()
    expect(useDocumentStore.getState().warningsDismissed).toBe(true)

    useDocumentStore.getState().addWarnings([{ tag: 'w:sdt', message: 'controls' }])
    expect(useDocumentStore.getState().warningsDismissed).toBe(false)
  })

  it('ignores an empty batch rather than resurfacing the banner', () => {
    useDocumentStore.getState().dismissWarnings()
    useDocumentStore.getState().addWarnings([])
    expect(useDocumentStore.getState().warningsDismissed).toBe(true)
  })

  it('clears warnings for a new document', () => {
    useDocumentStore.getState().addWarnings([{ tag: 'w:tbl', message: 'tables' }])
    useDocumentStore.getState().newDocument()
    expect(useDocumentStore.getState().warnings).toEqual([])
  })
})

describe('uniqueWarnings', () => {
  it('collapses repeats of the same construct', () => {
    const warnings = [
      { tag: 'w:tbl', message: 'first' },
      { tag: 'w:tbl', message: 'second' },
      { tag: 'w:sdt', message: 'third' },
    ]
    expect(uniqueWarnings(warnings).map((warning) => warning.tag)).toEqual(['w:tbl', 'w:sdt'])
  })

  it('keeps the first message for each construct', () => {
    const warnings = [
      { tag: 'w:tbl', message: 'first' },
      { tag: 'w:tbl', message: 'second' },
    ]
    expect(uniqueWarnings(warnings)[0]?.message).toBe('first')
  })
})

describe('windowTitle', () => {
  it('shows the file name without its extension', () => {
    expect(windowTitle({ path: '/a/report.docx', dirty: false })).toBe('report')
  })

  it('marks unsaved changes', () => {
    expect(windowTitle({ path: '/a/report.docx', dirty: true })).toBe('report — Edited')
  })

  it('falls back to Untitled for a document that was never saved', () => {
    expect(windowTitle({ path: null, dirty: false })).toBe('Untitled document')
  })
})

describe('documentFileName', () => {
  it('keeps the extension', () => {
    expect(documentFileName({ path: '/a/report.docx' })).toBe('report.docx')
  })
})
