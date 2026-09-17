import { readHeaderFooter, writeHeaderFooter } from './header-footer-session'
import { paragraphsFromText, textFromParagraphs } from './header-footer-text'
import type { DocxPackage } from '../ooxml/package'
import type { SectionProperties } from '../ooxml/section'
import type { HeaderFooterValues } from '../store/header-footer-store'

/**
 * The headers and footers of one section.
 *
 * Each section has its own, and a section that has none inherits the ones
 * before it — so what belongs to the section the cursor is in is what should be
 * shown and what an edit should change. Reading and writing are both stated
 * against a section rather than against the document.
 */

/** What the section says, with the first-page pair empty when it has none. */
export function readSectionHeaders(
  pkg: DocxPackage,
  section: SectionProperties,
): HeaderFooterValues {
  return {
    header: textFromParagraphs(readHeaderFooter(pkg, section, 'header').paragraphs),
    footer: textFromParagraphs(readHeaderFooter(pkg, section, 'footer').paragraphs),
    firstHeader: textFromParagraphs(readHeaderFooter(pkg, section, 'header', 'first').paragraphs),
    firstFooter: textFromParagraphs(readHeaderFooter(pkg, section, 'footer', 'first').paragraphs),
  }
}

/**
 * Writes them into the package and returns the section, with any reference it
 * had to create.
 *
 * The first-page pair goes in only where the section sets that page apart:
 * without `w:titlePg` Word ignores those parts, and the file would carry
 * headers it never shows.
 */
export function writeSectionHeaders(
  pkg: DocxPackage,
  section: SectionProperties,
  values: HeaderFooterValues,
): SectionProperties {
  let updated = writeHeaderFooter(pkg, section, 'header', paragraphsFromText(values.header))
  updated = writeHeaderFooter(pkg, updated, 'footer', paragraphsFromText(values.footer))

  if (!updated.differentFirstPage) return updated

  updated = writeHeaderFooter(
    pkg,
    updated,
    'header',
    paragraphsFromText(values.firstHeader),
    'first',
  )

  return writeHeaderFooter(pkg, updated, 'footer', paragraphsFromText(values.firstFooter), 'first')
}
