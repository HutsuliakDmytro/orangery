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

/**
 * The relationship that names a package's main part.
 *
 * `word/document.xml` is a convention, not a rule: what makes a part the
 * document is `_rels/.rels` pointing its `officeDocument` relationship at it.
 * Only used to explain a package we could not open — see `readPackage`.
 */
const OFFICE_DOCUMENT = /Target="([^"]+)"[^>]*officeDocument"|officeDocument"[^>]*Target="([^"]+)"/u

/** What an OpenDocument file says it is, in the entry it keeps first and stored. */
const OPEN_DOCUMENT = /^application\/vnd\.oasis\.opendocument\.(\w+)/u

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
  /**
   * The part the package is about, as `_rels/.rels` names it.
   *
   * `word/document.xml`, `xl/workbook.xml` and `ppt/presentation.xml` are
   * conventions rather than rules: what makes a part the main one is the
   * root relationship of type `officeDocument` pointing at it. Word writes
   * the conventional name and almost everything else does too — and then
   * LibreOffice's `tdf104713_undefinedStyles.docx` calls it `word/trial.xml`,
   * Word opens it, and a reader that hardcoded the name does not.
   *
   * Null — or absent, for a package built in memory rather than read — where a
   * caller that needs a main part falls back to the conventional name for its
   * format. `mainPartOf` is that fallback, in one place.
   */
  main?: string | null
}

/** What a caller expects a package to be, for the error when it is not. */
export interface PackageExpectation {
  /** The conventional path, which is also what a new package is given. */
  conventional: string
  /**
   * The content types the main part may be declared as.
   *
   * Checked rather than assumed: a `.docx` renamed from a `.pptx` has a main
   * part and a root relationship, and the only thing that says it is the wrong
   * one is `[Content_Types].xml`. A list because one format has several — a
   * workbook with macros in it is a workbook, and says so differently.
   */
  contentType: readonly string[]
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
  expected?: string | PackageExpectation,
): Promise<OoxmlPackage> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch (error) {
    // JSZip says things like "Bug : uncompressed data size mismatch", which is
    // an accurate description of a file somebody fuzzed and no use at all to
    // the person who double-clicked it.
    throw new OoxmlFormatError(
      `this file is not a readable zip, so it is not an Office package: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const parts = new Map<string, OoxmlPart>()

  // `zip.files` preserves the order entries appeared in the archive.
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path]
    if (!entry || entry.dir) continue

    const name = packagePath(path)
    let bytes: Uint8Array
    try {
      bytes = await entry.async('uint8array')
    } catch (error) {
      // A zip whose directory reads and whose entries do not: the archive is
      // damaged, and which part it stopped on is the useful half of that.
      throw new OoxmlFormatError(
        `this package is damaged: ${name} could not be read out of it (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }

    const part: OoxmlPart = { path: name, bytes, date: entry.date }
    if (isTextPart(name)) part.text = new TextDecoder().decode(bytes)

    parts.set(name, part)
  }

  const pkg: OoxmlPackage = { parts, main: mainPathOf(parts) }

  if (expected === undefined) return pkg

  if (typeof expected === 'string') {
    if (!parts.has(expected)) throw new OoxmlFormatError(whyNotAPackage(parts, expected))
    return pkg
  }

  // The relationship first, the convention second: a package that names its
  // main part is believed, and one that names nothing is assumed to have used
  // the name everybody else uses.
  const main = pkg.main ?? null
  const path = main ?? (parts.has(expected.conventional) ? expected.conventional : null)

  if (path === null) throw new OoxmlFormatError(whyNotAPackage(parts, expected.conventional))

  // Only when the package says something: a `[Content_Types].xml` with no
  // override for the main part is unusual and is not grounds for refusing a
  // file whose relationship already said what it is.
  const declared = contentTypeIn(parts, path)
  if (declared !== null && !expected.contentType.includes(declared)) {
    throw new OoxmlFormatError(
      `this package's main part is ${path}, which calls itself ${declared}; what was being opened keeps its main part at ${expected.conventional}`,
    )
  }

  return { ...pkg, main: path }
}

/** The `officeDocument` relationship's target, as a package path. */
function mainPathOf(parts: ReadonlyMap<string, OoxmlPart>): string | null {
  const found = OFFICE_DOCUMENT.exec(parts.get('_rels/.rels')?.text ?? '')
  const target = (found?.[1] ?? found?.[2])?.replace(/^\//u, '')
  return target !== undefined && parts.has(target) ? target : null
}

/**
 * What `[Content_Types].xml` says a part is.
 *
 * A second, smaller reader than `contentTypeOf` in `media.ts`, and on purpose:
 * this runs while the package is still a map of parts, before anything has a
 * package to hand it, and it only ever needs the override for one path.
 */
function contentTypeIn(parts: ReadonlyMap<string, OoxmlPart>, path: string): string | null {
  const types = parts.get(CONTENT_TYPES_PART)?.text ?? ''
  const wanted = path.startsWith('/') ? path : `/${path}`

  for (const match of types.matchAll(/<Override\s[^>]*\/?>/gu)) {
    const tag = match[0]
    const name = /PartName="([^"]+)"/u.exec(tag)?.[1]
    if (name !== wanted) continue
    return /ContentType="([^"]+)"/u.exec(tag)?.[1] ?? null
  }

  return null
}

/** The part a package is about, or the conventional name when it names none. */
export function mainPartOf(pkg: OoxmlPackage, conventional: string): string {
  return pkg.main ?? conventional
}

/** Where a part keeps its relationships: beside it, under `_rels`. */
export function relsPartFor(path: string): string {
  const cut = path.lastIndexOf('/')
  const directory = cut === -1 ? '' : path.slice(0, cut + 1)
  return `${directory}_rels/${path.slice(cut + 1)}.rels`
}

/**
 * A zip entry name as a part name.
 *
 * The zip specification says `/`, and some writers — old Java ones especially,
 * and whatever produced LibreOffice's `tdf76115.xlsx` — use the separator the
 * platform they ran on prefers. Excel and Word read those files, so the
 * separator is a fact about the archive rather than about the package, and it
 * is normalised here where the archive stops.
 */
function packagePath(entry: string): string {
  return entry.includes('\\') ? entry.replace(/\\/gu, '/') : entry
}

/**
 * Why the package is not the one that was asked for.
 *
 * "word/document.xml is missing" is true and unhelpful: the interesting cases
 * are a file that is not a `.docx` at all, and a `.docx` whose main part is
 * called something else — which is legal, and which we do not read yet. Saying
 * which one it is costs a lookup and saves somebody an afternoon.
 */
function whyNotAPackage(parts: ReadonlyMap<string, OoxmlPart>, requiredPart: string): string {
  const declared = new TextDecoder().decode(parts.get('mimetype')?.bytes ?? new Uint8Array())
  const openDocument = OPEN_DOCUMENT.exec(declared.trim())
  if (openDocument !== null) {
    const kind =
      {
        text: 'text (.odt)',
        spreadsheet: 'spreadsheet (.ods)',
        presentation: 'presentation (.odp)',
      }[openDocument[1] ?? ''] ?? openDocument[1]
    return `this is an OpenDocument ${String(kind)} rather than an Office package, whatever it has been named`
  }

  const relationships = parts.get('_rels/.rels')?.text ?? ''
  const found = OFFICE_DOCUMENT.exec(relationships)
  const target = (found?.[1] ?? found?.[2])?.replace(/^\//u, '')

  if (target !== undefined && target !== requiredPart && parts.has(target)) {
    return `this package keeps its main part at ${target} rather than ${requiredPart}; a name other than the conventional one is legal and is not read yet`
  }

  return `not the expected package: ${requiredPart} is missing`
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

export interface WriteOptions {
  /**
   * Parts to store uncompressed rather than deflate.
   *
   * OOXML never needs this; OpenDocument does. Its `mimetype` entry has to be
   * first and stored, so that a reader can tell what the file is from its first
   * bytes without unzipping it — and a zip is a container, so which entries are
   * deflated is a fact about the container rather than about either format.
   */
  stored?: readonly string[]
}

export async function writePackage(
  pkg: OoxmlPackage,
  options: WriteOptions = {},
): Promise<Uint8Array> {
  const zip = new JSZip()
  const stored = new Set(options.stored ?? [])

  for (const part of pkg.parts.values()) {
    // Text parts are re-encoded from `text` so edits are picked up; binary parts
    // go back byte for byte.
    const content = part.text === undefined ? part.bytes : new TextEncoder().encode(part.text)
    zip.file(part.path, content, {
      date: part.date,
      binary: true,
      ...(stored.has(part.path) ? { compression: 'STORE' as const } : {}),
    })
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    // Word uses default deflate; matching it keeps sizes comparable.
    compressionOptions: { level: 6 },
  })
}
