import { create } from 'zustand'

/**
 * The document's header and footer text.
 *
 * Separate from `documentStore` because it is content, not metadata, and
 * separate from the ProseMirror document because a header is not part of the
 * body — it lives in its own package part.
 */

export interface HeaderFooterState {
  header: string
  footer: string
  /** True when the user edited them since the document was opened. */
  dirty: boolean

  load: (values: { header: string; footer: string }) => void
  setHeader: (text: string) => void
  setFooter: (text: string) => void
  reset: () => void
}

export const useHeaderFooterStore = create<HeaderFooterState>((set) => ({
  header: '',
  footer: '',
  dirty: false,

  load: ({ header, footer }) => {
    set({ header, footer, dirty: false })
  },
  setHeader: (text) => {
    set({ header: text, dirty: true })
  },
  setFooter: (text) => {
    set({ footer: text, dirty: true })
  },
  reset: () => {
    set({ header: '', footer: '', dirty: false })
  },
}))
