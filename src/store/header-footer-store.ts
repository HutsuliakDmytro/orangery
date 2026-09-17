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
  /**
   * The section these values were read from — the position of the break that
   * ends it, or null for the one the body holds.
   *
   * Held so a cursor moving into another section is noticed: the values shown
   * belong to a section, and showing one section's header while editing
   * another's is how a header ends up in the wrong place.
   */
  sectionKey: number | null

  load: (values: Partial<HeaderFooterValues>, sectionKey: number | null) => void
  set: (slot: HeaderFooterSlot, text: string) => void
  reset: () => void
}

export const useHeaderFooterStore = create<HeaderFooterState>((set) => ({
  ...EMPTY,
  dirty: false,
  sectionKey: null,

  load: (values, sectionKey) => {
    set({ ...EMPTY, ...values, sectionKey, dirty: false })
  },
  set: (slot, text) => {
    set({ [slot]: text, dirty: true })
  },
  reset: () => {
    set({ ...EMPTY, sectionKey: null, dirty: false })
  },
}))
