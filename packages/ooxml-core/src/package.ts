import JSZip from 'jszip'

/**
 * An OOXML package, held as read.
 *
 * Every OOXML format — `.docx`, `.pptx`, `.xlsx` — is the same thing underneath:
 * a zip whose entries are parts, tied together by relationship files and
 * declared in `[Content_Types].xml`. Which part carries the content is the only
 * difference, and that belongs to the app, not here.
 *
 * Every part is kept: the ones the app parses and the ones it does not. On save,
 * only the regenerated parts are rebuilt and everything else is written back
 * from these buffers, which is what makes preservation possible at all — see
 * `docs/adr/0001-monorepo.md` and `apps/docs/docs/adr/0003-docx-native-roundtrip.md`.
 */

/** Declares the type of every part; the one file present in any OOXML package. */
export const CONTENT_TYPES_PART = '[Content_Types].xml'

/** Parts whose bytes are text; everything else (media) stays binary. */
const TEXT_PART = /\.(xml|rels)$/i

export interface OoxmlPart {
  /** Path inside the zip, e.g. `word/styles.xml`. */
  path: string
  /** Decoded text for XML parts, undefined for binary ones. */
  text?: string
  /** Raw bytes; always present, and authoritative for binary parts. */
  bytes: Uint8Array
  /** Zip entry date, preserved so saving does not churn timestamps needlessly. */
  date: Date
}

export interface OoxmlPackage {
  /** Insertion order mirrors the zip's entry order, which Word is sensitive to. */
  parts: Map<string, OoxmlPart>
}

export class OoxmlFormatError extends Error {
  override readonly name = 'OoxmlFormatError'
}

export function isTextPart(path: string): boolean {
  return TEXT_PART.test(path)
}

/**
 * Reads a zip into parts.
 *
 * `requiredPart` is how an app says what it is opening: Docs passes
 * `word/document.xml`, so a `.pptx` renamed to `.docx` fails here with
 * something a person can read, rather than three layers deeper as a missing
 * element.
 */
export async function readPackage(
  data: ArrayBuffer | Uint8Array,
  requiredPart?: string,
): Promise<OoxmlPackage> {
  const zip = await JSZip.loadAsync(data)
  const parts = new Map<string, OoxmlPart>()

  // `zip.files` preserves the order entries appeared in the archive.
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path]
    if (!entry || entry.dir) continue

    const bytes = await entry.async('uint8array')
    const part: OoxmlPart = { path, bytes, date: entry.date }
    if (isTextPart(path)) part.text = new TextDecoder().decode(bytes)

    parts.set(path, part)
  }

  if (requiredPart !== undefined && !parts.has(requiredPart)) {
    throw new OoxmlFormatError(`not the expected package: ${requiredPart} is missing`)
  }

  return { parts }
}

export function getPartText(pkg: OoxmlPackage, path: string): string | undefined {
  return pkg.parts.get(path)?.text
}

/** Replaces a text part, leaving every other part untouched. */
export function setPartText(pkg: OoxmlPackage, path: string, text: string): void {
  const existing = pkg.parts.get(path)
  const bytes = new TextEncoder().encode(text)

  pkg.parts.set(path, {
    path,
    text,
    bytes,
    date: existing?.date ?? new Date(),
  })
}

export async function writePackage(pkg: OoxmlPackage): Promise<Uint8Array> {
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
