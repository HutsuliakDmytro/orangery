import {
  attribute,
  buildXml,
  children,
  element,
  parseXml,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import JSZip from 'jszip'
import { contentTypeFor } from '../ooxml/image'
import {
  MANIFEST_PART,
  MIMETYPE_PART,
  ODT_MIME_TYPE,
  openOdt,
  PICTURES_FOLDER,
} from './converters/odt'
import type { OdtPackage, OpenOdt } from './converters/odt'

/**
 * Building an ODT package from nothing.
 *
 * The counterpart of `newDocxTemplate`, used when a document that has no
 * package of its own is saved as OpenDocument. The template is the minimum
 * LibreOffice opens without complaint: the mimetype, a manifest listing every
 * part, the body, and the styles the body refers to.
 */

const NAMESPACES = [
  ['xmlns:office', 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'],
  ['xmlns:text', 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'],
  ['xmlns:style', 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'],
  ['xmlns:table', 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'],
  ['xmlns:draw', 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'],
  ['xmlns:fo', 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'],
  ['xmlns:svg', 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0'],
  ['xmlns:xlink', 'http://www.w3.org/1999/xlink'],
] as const

function namespaceAttributes(): string {
  return NAMESPACES.map(([name, value]) => `${name}="${value}"`).join(' ')
}

export function newOdtTemplate(): { text: Record<string, string> } {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${namespaceAttributes()} office:version="1.3"><office:automatic-styles/><office:body><office:text><text:p text:style-name="Standard"/></office:text></office:body></office:document-content>`

  // Defaults match CLAUDE.md's: Arial 11pt, 1.15 line spacing, Letter with one
  // inch margins — the same page a new DOCX starts on.
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${namespaceAttributes()} office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties style:line-height-at-least="0.174in"/><style:text-properties style:font-name="Arial" fo:font-size="11pt"/></style:default-style><style:style style:name="Standard" style:family="paragraph"/>${headingStyles()}</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in" style:print-orientation="portrait" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1in" fo:margin-right="1in"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`

  return {
    text: {
      [MANIFEST_PART]: manifestFor(['content.xml', 'styles.xml']),
      'content.xml': content,
      'styles.xml': styles,
    },
  }
}

function headingStyles(): string {
  const sizes = ['22pt', '18pt', '16pt', '14pt', '13pt', '12pt']
  return sizes
    .map((size, index) => {
      const level = index + 1
      // ODF spells a space in a style name as `_20_`, which is why the built-in
      // headings are `Heading_20_1` rather than `Heading 1`.
      return `<style:style style:name="Heading_20_${String(level)}" style:display-name="Heading ${String(level)}" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="${String(level)}"><style:text-properties fo:font-size="${size}" fo:font-weight="bold"/></style:style>`
    })
    .join('')
}

/** The manifest, which has to list the root and every part in the package. */
export function manifestFor(paths: readonly string[]): string {
  const entries = [
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIME_TYPE}" manifest:version="1.3"/>`,
    ...paths.map((path) => {
      const mediaType = path.endsWith('.xml') ? 'text/xml' : (contentTypeFor(path) ?? '')
      return `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${mediaType}"/>`
    }),
  ]

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">${entries.join('')}</manifest:manifest>`
}

/** Next free `imageN.ext`, so an added picture never overwrites an existing one. */
export function nextPictureName(pkg: OdtPackage, extension: string): string {
  let highest = 0
  for (const path of pkg.parts.keys()) {
    const match = /^Pictures\/image(\d+)\./u.exec(path)
    if (match?.[1]) highest = Math.max(highest, Number.parseInt(match[1], 10))
  }
  return `image${String(highest + 1)}.${extension}`
}

/**
 * Adds a picture to the package and returns the path a frame refers to it by.
 *
 * The manifest is updated in the same step: a part the manifest does not list
 * is not part of the document as far as a reader is concerned.
 */
export function addPicture(pkg: OdtPackage, extension: string, bytes: Uint8Array): string {
  const href = `${PICTURES_FOLDER}${nextPictureName(pkg, extension)}`
  pkg.parts.set(href, { bytes })
  declareInManifest(pkg, href)
  return href
}

function declareInManifest(pkg: OdtPackage, path: string): void {
  const manifest = pkg.parts.get(MANIFEST_PART)?.text
  if (manifest === undefined) return

  const roots = parseXml(manifest)
  const root = roots.find((node) => tagName(node) === 'manifest:manifest')
  if (!root) return

  const list = root['manifest:manifest']
  if (!Array.isArray(list)) return

  const already = children(root).some((node) => attribute(node, 'manifest:full-path') === path)
  if (already) return

  list.push(
    element('manifest:file-entry', {
      'manifest:full-path': path,
      'manifest:media-type': contentTypeFor(path) ?? '',
    }),
  )

  const xml = withDeclaration(buildXml(roots))
  pkg.parts.set(MANIFEST_PART, { bytes: new TextEncoder().encode(xml), text: xml })
}

/** Builds the package for a document being converted to OpenDocument. */
export async function createNewOdt(): Promise<OpenOdt> {
  const zip = new JSZip()

  // `mimetype` goes in first and uncompressed, which is how a reader identifies
  // the package without unzipping it.
  zip.file(MIMETYPE_PART, ODT_MIME_TYPE, { compression: 'STORE' })
  for (const [path, contents] of Object.entries(newOdtTemplate().text)) {
    zip.file(path, contents)
  }

  return openOdt(await zip.generateAsync({ type: 'uint8array' }))
}
