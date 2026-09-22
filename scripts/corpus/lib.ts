import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, relative } from 'node:path'
import JSZip from 'jszip'

/**
 * What the corpus scripts all need to know.
 *
 * One file reads a package and says what is in it; the inventory, the
 * selection and the round-trip runner all ask that same question and would
 * otherwise each answer it slightly differently — which is how two reports
 * about the same corpus come to disagree.
 */

export const RAW_ROOT = process.env['ORANGERY_CORPUS_RAW'] ?? join(homedir(), 'corpus-raw')
export const FULL_ROOT = process.env['ORANGERY_CORPUS_FULL'] ?? join(homedir(), 'corpus-full')

/** Where the public corpus lives, relative to the repository root. */
export const PUBLIC_ROOT = 'tests/fixtures/office'

export type Format = 'docx' | 'pptx' | 'xlsx' | 'other'

/**
 * Which pile a file belongs to.
 *
 * `corpus` is a package we could plausibly open. `legacy` is the binary
 * formats — a different reader entirely, kept because one day there may be
 * one. `hostile` is the files that are not meant to open: POI's deliberately
 * corrupted fixtures and anything behind a password.
 */
export type Bucket = 'corpus' | 'legacy' | 'hostile'

export interface Generator {
  /** `docProps/app.xml` `<Application>`, verbatim. */
  application: string | null
  /** `<AppVersion>`, which is how a Word 2016 file is told from a Word 2010 one. */
  version: string | null
  /** The two of them boiled down to something countable: `word2016`, `poi`. */
  slug: string
}

export interface Entry {
  path: string
  relative: string
  source: string
  extension: string
  size: number
  sha1: string
  /** Whether the bytes are a zip at all. */
  zip: boolean
  contentTypes: boolean
  bucket: Bucket
  /** Why it is not in `corpus`, when it is not. */
  reason: string | null
  format: Format
  generator: Generator
  parts: string[]
  features: string[]
  /** Rows in the largest sheet, for the one or two workbooks worth keeping big. */
  rows: number | null
}

const LEGACY = new Set(['.doc', '.xls', '.ppt', '.pps', '.xlt', '.dot', '.pot', '.xlsb'])
/** Formats that are not ours but are office documents, kept apart from source code. */
const OTHER_OFFICE = new Set([
  '.odt',
  '.ods',
  '.odp',
  '.odg',
  '.fodt',
  '.fods',
  '.fodp',
  '.fodg',
  '.rtf',
  '.vsd',
  '.vsdx',
  '.pub',
  '.wps',
  '.wpd',
  '.sxw',
  '.sxi',
  '.sxc',
])

const OOXML = new Set([
  '.docx',
  '.docm',
  '.dotx',
  '.dotm',
  '.pptx',
  '.pptm',
  '.potx',
  '.ppsx',
  '.xlsx',
  '.xlsm',
  '.xltx',
  '.xltm',
])

/** Names POI gives the files it made broken on purpose. */
const DELIBERATELY_BROKEN =
  /(corrupt|bogus|broken|invalid|malformed|truncat|damaged|bad[-_.]|[-_.]bad|garbage|fuzz|clusterfuzz|testcase)/i

/**
 * Names that say the file is behind a password before we ever open it.
 *
 * "protect" on its own is deliberately not here: a sheet with protection
 * turned on is an ordinary file with a feature worth having in the corpus,
 * and both LibreOffice and POI have dozens of them.
 */
const PROTECTED = /(password|passwd|encrypt|decrypt|crypto)/i

/** Whether the extension is one of ours — a zip of parts, not a binary record stream. */
export function isOoxml(extension: string): boolean {
  return OOXML.has(extension)
}

/** Whether a path is worth an inventory row at all, as opposed to being a repository's own source. */
export function isDocument(extension: string): boolean {
  return OOXML.has(extension) || LEGACY.has(extension) || OTHER_OFFICE.has(extension)
}

export function formatOf(extension: string): Format {
  if (/^\.do[ct][xm]?$/i.test(extension)) return 'docx'
  if (/^\.p[po][tsx][xm]?$/i.test(extension)) return 'pptx'
  if (/^\.xl[st][xmb]?$/i.test(extension)) return 'xlsx'
  return 'other'
}

/** Every file under a root, depth first, with `.git` and its objects skipped. */
export async function* walk(root: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

/** The first path segment under the raw root, which is the project it came from. */
export function sourceOf(relativePath: string): string {
  return relativePath.split('/')[0] ?? 'unknown'
}

/**
 * What a `docProps/app.xml` says, reduced to something worth grouping by.
 *
 * The raw string is kept as well: "Microsoft Macintosh Word" and "Microsoft
 * Office Word" are the same program on two platforms, and which one wrote a
 * file is exactly the kind of thing a round-trip failure turns out to hinge on.
 */
export function generatorSlug(application: string | null, version: string | null): string {
  const name = (application ?? '').toLowerCase()
  const major = /^(\d+)/.exec(version ?? '')?.[1] ?? ''

  const office = (word: string): string => {
    const year =
      { '16': '2016', '15': '2013', '14': '2010', '12': '2007', '11': '2003' }[major] ?? major
    const mac = name.includes('macintosh') || name.includes('mac')
    return `${word}${year}${mac ? 'mac' : year === '' ? '' : 'win'}`
  }

  if (name.includes('word')) return office('word')
  if (name.includes('excel')) return office('excel')
  if (name.includes('powerpoint')) return office('powerpoint')
  if (name.includes('libreoffice')) return 'libreoffice'
  if (name.includes('openoffice')) return 'openoffice'
  if (name.includes('poi') || name.includes('apache')) return 'poi'
  if (name.includes('kingsoft') || name.includes('wps')) return 'wps'
  if (name.includes('google')) return 'gdocs'
  if (name.includes('keynote') || name.includes('pages') || name.includes('numbers')) return 'iwork'
  if (name.includes('python')) return 'pythonopenxml'
  if (name !== '') return name.replace(/[^a-z0-9]+/g, '').slice(0, 16)
  return 'unknown'
}

function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i').exec(xml)
  return match?.[1]?.trim() ?? null
}

/** Reads a part as text, or an empty string when it is not there. */
async function partText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  if (entry === null) return ''
  try {
    return await entry.async('string')
  } catch {
    return ''
  }
}

/** The parts we look inside, by what we are hoping to find there. */
function has(parts: string[], pattern: RegExp): boolean {
  return parts.some((part) => pattern.test(part))
}

/**
 * What a package holds, in the terms the selection matrix is written in.
 *
 * Deliberately shallow: a regex over the part text rather than a parse, because
 * this runs over three thousand files and the question is only ever "is there
 * one of these in here", never "what does it say".
 */
async function featuresOf(zip: JSZip, parts: string[], format: Format): Promise<string[]> {
  const found = new Set<string>()

  if (has(parts, /\/charts\/chart\d*\.xml$/)) found.add('charts')
  if (has(parts, /\/diagrams\/data\d*\.xml$/)) found.add('smartart')
  if (has(parts, /vbaProject\.bin$/)) found.add('vba')
  if (has(parts, /\/embeddings\//)) found.add('embeddings')
  if (has(parts, /\/media\//)) found.add('media')
  if (has(parts, /\/media\/.*\.(mp4|mov|avi|wmv|m4a|mp3|wav)$/i)) found.add('av')
  if (has(parts, /customXml\//)) found.add('customxml')
  if (has(parts, /\/fonts?\/.*\.(fntdata|odttf)$/i)) found.add('embeddedfonts')

  if (format === 'docx') {
    const document = await partText(zip, 'word/document.xml')
    const styles = await partText(zip, 'word/styles.xml')

    if (has(parts, /word\/numbering\.xml$/)) found.add('numbering')
    if (has(parts, /word\/header\d*\.xml$/)) found.add('headers')
    if (has(parts, /word\/footer\d*\.xml$/)) found.add('footers')
    if (has(parts, /word\/comments\.xml$/)) found.add('comments')
    // Asked of the body, not of `footnotes.xml`: every Word file has that part
    // and every one of them has the separator notes in it, so its presence says
    // nothing about whether the document has a footnote in it.
    if (has(parts, /word\/footnotes\.xml$/) && /<w:footnoteReference\b/.test(document))
      found.add('footnotes')
    if (/<w:tbl>/.test(document)) found.add('tables')
    if (/<wp:anchor\b/.test(document)) found.add('anchored')
    if (/<wp:inline\b/.test(document)) found.add('inlineimage')
    if ((document.match(/<w:sectPr\b/g) ?? []).length > 1) found.add('sections')
    if (/<w:instrText|<w:fldChar|<w:fldSimple/.test(document)) found.add('fields')
    if (/TOC \\|<w:instrText[^>]*>\s*TOC/.test(document)) found.add('toc')
    if (/<w:ins\b|<w:del\b/.test(document)) found.add('trackchanges')
    if (/<m:oMath/.test(document)) found.add('math')
    if (/<w:sdt>/.test(document)) found.add('sdt')
    if (/<w:bidi\b|<w:rtl\b|w:rtl="(1|true)"/.test(document)) found.add('rtl')
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(document)) found.add('cjk')
    if ((styles.match(/<w:style\b/g) ?? []).length > 30) found.add('stylesheavy')
  }

  if (format === 'pptx') {
    const slides = parts.filter((part) => /ppt\/slides\/slide\d+\.xml$/.test(part))
    const presentation = await partText(zip, 'ppt/presentation.xml')
    const sample = (await Promise.all(slides.slice(0, 12).map((part) => partText(zip, part)))).join(
      '',
    )

    if (parts.filter((part) => /slideMasters\/slideMaster\d+\.xml$/.test(part)).length > 1)
      found.add('multimaster')
    if (parts.filter((part) => /slideLayouts\/slideLayout\d+\.xml$/.test(part)).length > 8)
      found.add('manylayouts')
    if (has(parts, /notesSlides\/notesSlide\d+\.xml$/)) found.add('notes')
    if (has(parts, /ppt\/(comments|modernComments)/)) found.add('comments')
    if (/<p14:sectionLst|<p:sectionLst/.test(presentation)) found.add('sections')
    if (/<p:ph\b/.test(sample)) found.add('placeholders')
    if (/<p:grpSp>/.test(sample)) found.add('groups')
    if (/<a:tbl>/.test(sample)) found.add('tables')
    if (/<a:custGeom>/.test(sample)) found.add('customgeometry')
    if (/<p:transition\b/.test(sample)) found.add('transitions')
    if (/<p:timing>[\s\S]*<p:(anim|animEffect|animMotion|animRot|animScale)\b/.test(sample))
      found.add('animations')
    if (slides.length > 20) found.add('manyslides')
  }

  if (format === 'xlsx') {
    const workbook = await partText(zip, 'xl/workbook.xml')
    const styles = await partText(zip, 'xl/styles.xml')
    const sheets = parts.filter((part) => /xl\/worksheets\/sheet\d+\.xml$/.test(part))
    const sample = (await Promise.all(sheets.slice(0, 4).map((part) => partText(zip, part)))).join(
      '',
    )

    if (has(parts, /xl\/sharedStrings\.xml$/)) found.add('sharedstrings')
    if (/t="inlineStr"/.test(sample)) found.add('inlinestrings')
    if (/<numFmt\b/.test(styles)) found.add('numfmt')
    if (/<f[ >]/.test(sample)) found.add('formulas')
    if (/t="shared"/.test(sample)) found.add('sharedformulas')
    if (/t="array"/.test(sample)) found.add('arrayformulas')
    if (has(parts, /xl\/metadata\.xml$/)) found.add('dynamicarrays')
    if (/<definedName\b/.test(workbook)) found.add('definednames')
    if (has(parts, /xl\/tables\/table\d+\.xml$/)) found.add('tables')
    if (/<conditionalFormatting\b/.test(sample)) found.add('conditional')
    if (/<dataValidation\b/.test(sample)) found.add('validation')
    if (/<mergeCell\b/.test(sample)) found.add('merges')
    if (/<pane\b[^>]*state="(frozen|frozenSplit)"/.test(sample)) found.add('freeze')
    if (has(parts, /xl\/pivotTables\//) || has(parts, /xl\/pivotCache\//)) found.add('pivots')
    if (has(parts, /xl\/(comments\d*\.xml|threadedComments\/)/)) found.add('comments')
    if (has(parts, /xl\/externalLinks\//)) found.add('externallinks')
    if (/date1904="(1|true)"/.test(workbook)) found.add('date1904')
  }

  return [...found].sort()
}

/** Rows in the biggest sheet, which is the only sense in which a workbook is large. */
async function rowsOf(zip: JSZip, parts: string[]): Promise<number | null> {
  let most = 0

  for (const part of parts.filter((one) => /xl\/worksheets\/sheet\d+\.xml$/.test(one))) {
    const text = await partText(zip, part)
    const last = /<row[^>]*\br="(\d+)"(?![\s\S]*<row[^>]*\br=")/.exec(text)?.[1]
    most = Math.max(most, Number(last ?? 0))
  }

  return most === 0 ? null : most
}

/** OLE compound file — what a password-protected OOXML package is wrapped in. */
function isCompoundFile(bytes: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return magic.every((byte, index) => bytes[index] === byte)
}

export async function inspect(path: string, root: string): Promise<Entry> {
  const bytes = await readFile(path)
  const relativePath = relative(root, path)
  const extension = extname(path).toLowerCase()
  const format = formatOf(extension)
  const name = path.split('/').pop() ?? path

  const entry: Entry = {
    path,
    relative: relativePath,
    source: sourceOf(relativePath),
    extension,
    size: bytes.byteLength,
    sha1: createHash('sha1').update(bytes).digest('hex'),
    zip: false,
    contentTypes: false,
    bucket: 'corpus',
    reason: null,
    format,
    generator: { application: null, version: null, slug: 'unknown' },
    parts: [],
    features: [],
    rows: null,
  }

  if (LEGACY.has(extension)) {
    entry.bucket = 'legacy'
    entry.reason = 'binary format'
    // Still worth knowing it is what it claims: a `.xls` that is really a zip
    // is a renamed `.xlsx`, and POI's test data has a few.
    entry.zip = bytes[0] === 0x50 && bytes[1] === 0x4b
    return entry
  }

  if (!OOXML.has(extension)) {
    entry.bucket = 'legacy'
    entry.reason = 'another office format (ODF, RTF, Visio)'
    return entry
  }

  if (isCompoundFile(bytes)) {
    entry.bucket = 'hostile'
    entry.reason = 'encrypted (OLE container, not a zip)'
    return entry
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (error) {
    entry.bucket = 'hostile'
    entry.reason = `not a zip: ${error instanceof Error ? error.message : String(error)}`
    return entry
  }

  entry.zip = true
  entry.parts = Object.keys(zip.files).filter((file) => !zip.files[file]?.dir)
  entry.contentTypes = entry.parts.includes('[Content_Types].xml')

  const app = await partText(zip, 'docProps/app.xml')
  entry.generator.application = tagText(app, 'Application')
  entry.generator.version = tagText(app, 'AppVersion')
  entry.generator.slug = generatorSlug(entry.generator.application, entry.generator.version)

  if (has(entry.parts, /^EncryptedPackage$/) || has(entry.parts, /EncryptionInfo/)) {
    entry.bucket = 'hostile'
    entry.reason = 'encrypted package'
    return entry
  }

  if (!entry.contentTypes) {
    entry.bucket = 'hostile'
    entry.reason = 'no [Content_Types].xml'
    return entry
  }

  if (DELIBERATELY_BROKEN.test(name)) {
    entry.bucket = 'hostile'
    entry.reason = 'named as a deliberately broken fixture'
    return entry
  }

  if (PROTECTED.test(name)) {
    entry.bucket = 'hostile'
    entry.reason = 'named as password-protected'
    return entry
  }

  entry.features = await featuresOf(zip, entry.parts, format)
  if (format === 'xlsx') entry.rows = await rowsOf(zip, entry.parts)

  return entry
}

/** Runs `work` over `items` with a fixed number in flight, in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await work(items[index] as T, index)
    }
  })

  await Promise.all(workers)
  return results
}

export function formatBytes(size: number): string {
  if (size > 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size > 1024) return `${(size / 1024).toFixed(0)} kB`
  return `${String(size)} B`
}

export interface Inventory {
  root: string
  generated: string
  entries: Entry[]
}

export async function readInventory(path: string): Promise<Inventory> {
  return JSON.parse(await readFile(path, 'utf8')) as Inventory
}
