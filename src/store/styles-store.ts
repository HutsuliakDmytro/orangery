import { create } from 'zustand'
import { headingLevelOf, parseStyles, visibleParagraphStyles } from '../ooxml/styles'
import type { DocumentStyle, StyleCatalogue } from '../ooxml/styles'

/**
 * The open document's style catalogue, for the toolbar's style dropdown.
 *
 * The list has to come from the file: a document defines its own styles, and
 * offering a fixed set would let the user pick a style the document does not
 * have — which Word would then render as plain body text.
 */

/** Styles the dropdown shows first, in Word's own order. */
const PREFERRED_ORDER = [
  'Normal',
  'Title',
  'Subtitle',
  'Heading1',
  'Heading2',
  'Heading3',
  'Heading4',
  'Heading5',
  'Heading6',
]

export interface StyleOption {
  id: string
  label: string
  /** Set when applying this style should produce a heading node. */
  headingLevel: number | null
}

export interface StylesState {
  catalogue: StyleCatalogue | null
  options: StyleOption[]
  setCatalogue: (catalogue: StyleCatalogue | null) => void
}

function rank(style: DocumentStyle): number {
  const index = PREFERRED_ORDER.indexOf(style.id)
  return index === -1 ? PREFERRED_ORDER.length : index
}

export function buildOptions(catalogue: StyleCatalogue | null): StyleOption[] {
  if (!catalogue) return []

  return visibleParagraphStyles(catalogue)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((style) => ({
      id: style.id,
      label: style.name,
      headingLevel: headingLevelOf(catalogue, style.id),
    }))
}

export const useStylesStore = create<StylesState>((set) => ({
  catalogue: null,
  options: [],

  setCatalogue: (catalogue) => {
    set({ catalogue, options: buildOptions(catalogue) })
  },
}))

/** Convenience for loading straight from a `styles.xml` part. */
export function catalogueFromXml(xml: string | undefined): StyleCatalogue {
  return parseStyles(xml ?? '')
}
