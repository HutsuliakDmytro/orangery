import { create } from 'zustand'
import type { DocumentFormat } from '../document/formats'
import { DEFAULT_FORMAT, displayNameOf, fileNameOf } from '../document/formats'
import type { ParseWarning } from '../ooxml/parse-document'

/**
 * Everything about the open document *except* its content, which lives in the
 * ProseMirror state. Keeping the text out of the store avoids mirroring the
 * document in two places, which is the usual source of "which copy is current?"
 * bugs.
 */

export interface DocumentState {
  /** Null until the document has been saved somewhere. */
  path: string | null
  format: DocumentFormat
  /** Unsaved changes. Drives the macOS dirty dot and the close prompt. */
  dirty: boolean
  /** Constructs preserved but not editable, surfaced as a banner. */
  warnings: ParseWarning[]
  /** Whether the user has dismissed the warnings banner for this document. */
  warningsDismissed: boolean
  lastSaved: Date | null
  /** Set while a save or open is in flight, so the UI can block a second one. */
  busy: boolean
  /** Stable id for the autosave directory of a never-saved document. */
  sessionId: string

  openDocument: (input: { path: string; format: DocumentFormat; warnings: ParseWarning[] }) => void
  newDocument: () => void
  markDirty: () => void
  markSaved: (path: string, format: DocumentFormat) => void
  setBusy: (busy: boolean) => void
  dismissWarnings: () => void
  addWarnings: (warnings: ParseWarning[]) => void
}

function newSessionId(): string {
  return `session-${Math.random().toString(36).slice(2, 10)}`
}

export const useDocumentStore = create<DocumentState>((set) => ({
  path: null,
  format: DEFAULT_FORMAT,
  dirty: false,
  warnings: [],
  warningsDismissed: false,
  lastSaved: null,
  busy: false,
  sessionId: newSessionId(),

  openDocument: ({ path, format, warnings }) => {
    set({
      path,
      format,
      warnings,
      warningsDismissed: false,
      // A freshly opened document matches its file, so it is not dirty.
      dirty: false,
      lastSaved: null,
      sessionId: newSessionId(),
    })
  },

  newDocument: () => {
    set({
      path: null,
      format: DEFAULT_FORMAT,
      warnings: [],
      warningsDismissed: false,
      dirty: false,
      lastSaved: null,
      sessionId: newSessionId(),
    })
  },

  markDirty: () => {
    set((state) => (state.dirty ? state : { ...state, dirty: true }))
  },

  markSaved: (path, format) => {
    set({ path, format, dirty: false, lastSaved: new Date() })
  },

  setBusy: (busy) => {
    set({ busy })
  },

  dismissWarnings: () => {
    set({ warningsDismissed: true })
  },

  addWarnings: (warnings) => {
    if (warnings.length === 0) return
    set((state) => ({
      warnings: [...state.warnings, ...warnings],
      warningsDismissed: false,
    }))
  },
}))

/** Title bar text: name plus an edited marker, as macOS apps show it. */
export function windowTitle(state: Pick<DocumentState, 'path' | 'dirty'>): string {
  const name = displayNameOf(state.path)
  return state.dirty ? `${name} — Edited` : name
}

export function documentFileName(state: Pick<DocumentState, 'path'>): string {
  return fileNameOf(state.path)
}

/** Distinct warnings, since one unsupported construct usually repeats. */
export function uniqueWarnings(warnings: ParseWarning[]): ParseWarning[] {
  const seen = new Map<string, ParseWarning>()
  for (const warning of warnings) {
    if (!seen.has(warning.tag)) seen.set(warning.tag, warning)
  }
  return [...seen.values()]
}
