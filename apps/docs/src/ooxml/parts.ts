import { mainPartOf, readPackage, relsPartFor } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Where a WordprocessingML package keeps things.
 *
 * The package machinery itself is shared with the rest of the suite and knows
 * nothing about `word/` — these names are what makes a zip a document rather
 * than a deck, so they stay with the app that reads documents.
 */

/**
 * What Word calls the document part, and what a new one is given.
 *
 * Not what an opened package's document part is: that is whatever
 * `_rels/.rels` points its `officeDocument` relationship at, which is usually
 * this and legally anything. Ask `documentPart(pkg)`.
 */
export const CONVENTIONAL_DOCUMENT_PART = 'word/document.xml'

/**
 * What `[Content_Types].xml` may call it for the package to be a document.
 *
 * Four, because a template and a document with macros in it are both documents
 * as far as opening one goes, and each says so differently.
 */
export const DOCUMENT_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  'application/vnd.ms-word.document.macroEnabled.main+xml',
  'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
]

/** The document part of this package, by name or by relationship. */
export function documentPart(pkg: OoxmlPackage): string {
  return mainPartOf(pkg, CONVENTIONAL_DOCUMENT_PART)
}

/** Where that part keeps its relationships, which follows its name. */
export function documentRelsPart(pkg: OoxmlPackage): string {
  return relsPartFor(documentPart(pkg))
}

export const STYLES_PART = 'word/styles.xml'
export const NUMBERING_PART = 'word/numbering.xml'
export const SETTINGS_PART = 'word/settings.xml'
export const FONT_TABLE_PART = 'word/fontTable.xml'

/** Reading a `.docx`: a package without a document part is not one. */
export function readDocxPackage(data: ArrayBuffer | Uint8Array): Promise<OoxmlPackage> {
  return readPackage(data, {
    conventional: CONVENTIONAL_DOCUMENT_PART,
    contentType: DOCUMENT_CONTENT_TYPES,
  })
}
