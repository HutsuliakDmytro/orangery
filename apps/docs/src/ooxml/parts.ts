import { readPackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Where a WordprocessingML package keeps things.
 *
 * The package machinery itself is shared with the rest of the suite and knows
 * nothing about `word/` — these names are what makes a zip a document rather
 * than a deck, so they stay with the app that reads documents.
 */

export const DOCUMENT_PART = 'word/document.xml'
export const STYLES_PART = 'word/styles.xml'
export const NUMBERING_PART = 'word/numbering.xml'
export const SETTINGS_PART = 'word/settings.xml'
export const FONT_TABLE_PART = 'word/fontTable.xml'

/** Reading a `.docx`: a package without a document part is not one. */
export function readDocxPackage(data: ArrayBuffer | Uint8Array): Promise<OoxmlPackage> {
  return readPackage(data, DOCUMENT_PART)
}
