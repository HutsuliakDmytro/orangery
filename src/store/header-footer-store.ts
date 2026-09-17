import { create } from 'zustand'

/**
 * The document's header and footer text.
 *
 * Separate from `documentStore` because it is content, not metadata, and
 * separate from the ProseMirror document because a header is not part of the
 * body — it lives in its own package part.
 *
 * A section can have two of each: the one every page uses, and one for the
 * opening page when it is set apart. They are different parts in the file, so
 * they are different values here rather than one that changes meaning.
 */

/** `default` is every page; `first` is the opening page of a title section. */
export type HeaderFooterSlot = 'header' | 'footer' | 'firstHeader' | 'firstFooter'

export const HEADER_FOOTER_SLOTS: readonly HeaderFooterSlot[] = [
  'header',
  'footer',
  'firstHeader',
  'firstFooter',
]

export type HeaderFooterValues = Record<HeaderFooterSlot, string>

const EMPTY: HeaderFooterValues = { header: '', footer: '', firstHeader: '', firstFooter: '' }

export interface HeaderFooterState extends HeaderFooterValues {
  /** True when the user edited them since the document was opened. */
  dirty: boolean

  load: (values: Partial<HeaderFooterValues>) => void
  set: (slot: HeaderFooterSlot, text: string) => void
  reset: () => void
}

export const useHeaderFooterStore = create<HeaderFooterState>((set) => ({
  ...EMPTY,
  dirty: false,

  load: (values) => {
    set({ ...EMPTY, ...values, dirty: false })
  },
  set: (slot, text) => {
    set({ [slot]: text, dirty: true })
  },
  reset: () => {
    set({ ...EMPTY, dirty: false })
  },
}))
