import JSZip from 'jszip'

/**
 * The DOCX package, held as read.
 *
 * Every part is kept: the ones we parse and the ones we do not. On save, only
 * `word/document.xml` is regenerated and everything else is written back from
 * these buffers, which is what makes preservation possible at all — see
 * `docs/adr/0003-docx-native-roundtrip.md`.
 */

export const DOCUMENT_PART = 'word/document.xml'
export const STYLES_PART = 'word/styles.xml'
export const NUMBERING_PART = 'word/numbering.xml'
export const SETTINGS_PART = 'word/settings.xml'
export const FONT_TABLE_PART = 'word/fontTable.xml'
export const CONTENT_TYPES_PART = '[Content_Types].xml'

/** Parts whose bytes are text; everything else (media) stays binary. */
const TEXT_PART = /\.(xml|rels)$/i

export interface DocxPart {
  /** Path inside the zip, e.g. `word/styles.xml`. */
  path: string
  /** Decoded text for XML parts, undefined for binary ones. */
  text?: string
  /** Raw bytes; always present, and authoritative for binary parts. */
  bytes: Uint8Array
  /** Zip entry date, preserved so saving does not churn timestamps needlessly. */
  date: Date
}

export interface DocxPackage {
  /** Insertion order mirrors the zip's entry order, which Word is sensitive to. */
  parts: Map<string, DocxPart>
}

export function isTextPart(path: string): boolean {
  return TEXT_PART.test(path)
}

export async function readPackage(data: ArrayBuffer | Uint8Array): Promise<DocxPackage> {
  const zip = await JSZip.loadAsync(data)
  const parts = new Map<string, DocxPart>()

  // `zip.files` preserves the order entries appeared in the archive.
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path]
    if (!entry || entry.dir) continue

    const bytes = await entry.async('uint8array')
    const part: DocxPart = { path, bytes, date: entry.date }
    if (isTextPart(path)) part.text = new TextDecoder().decode(bytes)

    parts.set(path, part)
  }

  if (!parts.has(DOCUMENT_PART)) {
    throw new DocxFormatError(`not a DOCX package: ${DOCUMENT_PART} is missing`)
  }

  return { parts }
}

export class DocxFormatError extends Error {
  override readonly name = 'DocxFormatError'
}

export function getPartText(pkg: DocxPackage, path: string): string | undefined {
  return pkg.parts.get(path)?.text
}

/** Replaces a text part, leaving every other part untouched. */
export function setPartText(pkg: DocxPackage, path: string, text: string): void {
  const existing = pkg.parts.get(path)
  const bytes = new TextEncoder().encode(text)

  pkg.parts.set(path, {
    path,
    text,
    bytes,
    date: existing?.date ?? new Date(),
  })
}

export async function writePackage(pkg: DocxPackage): Promise<Uint8Array> {
  const zip = new JSZip()

  for (const part of pkg.parts.values()) {
    // Text parts are re-encoded from `text` so edits are picked up; binary parts
    // go back byte for byte.
    const content = part.text === undefined ? part.bytes : new TextEncoder().encode(part.text)
    zip.file(part.path, content, { date: part.date, binary: true })
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    // Word uses default deflate; matching it keeps sizes comparable.
    compressionOptions: { level: 6 },
  })
}

/** Media files, for mapping relationship targets to bytes. */
export function mediaParts(pkg: DocxPackage): DocxPart[] {
  return [...pkg.parts.values()].filter((part) => part.path.startsWith('word/media/'))
}
