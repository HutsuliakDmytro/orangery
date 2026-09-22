import {
  writeRelationships,
  setPartXml,
  CONTENT_TYPES_PART,
  addRelationship,
  element,
  findByTarget,
  getPartText,
  parseRelationships,
  parseXml,
  resolveTarget,
  setPartText,
  tagName,
  writePackage,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { documentRelsPart, documentPart, NUMBERING_PART, readDocxPackage } from '../ooxml/parts'
import { parseTheme, resolveColor } from '@orangery/ooxml-drawingml'
import { allSeries, patchedWorkbook, readChart } from '@orangery/charts'
import type { ChartCategories, ChartValues } from '@orangery/charts'
import { parseNumbering } from '../ooxml/numbering'
import {
  allocateNumbering,
  mergeNumbering,
  NUMBERING_CONTENT_TYPE,
  NUMBERING_RELATIONSHIP,
} from '../ooxml/numbering-builder'
import type { NumberingCatalogue } from '../ooxml/numbering'
import { parseDocument } from '../ooxml/parse-document'
import type { ParseWarning, ProseMirrorNodeJson } from '../ooxml/parse-document'
import { parseStyles } from '../ooxml/styles'
import type { StyleCatalogue } from '../ooxml/styles'
import {
  footnoteText as readFootnoteText,
  FOOTNOTES_PART,
  parseFootnotes,
} from '../ooxml/footnotes'
import { mediaDataUrl } from './media'
import type { Footnote } from '../ooxml/footnotes'
import { writeFootnotes } from './footnotes-session'
import { parseSection, serializeSection } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import { serializeDocument } from '../ooxml/serialize-document'
import { readComments, writeComments } from './comments-session'
import { readTrackChanges, writeTrackChanges } from './track-changes-session'
import type { Comment } from '../ooxml/comments'
import { readHeadingNumbering, writeHeadingNumbering } from './heading-numbering-session'
import type { HeadingNumberScheme } from '../editor/heading-numbers'

/**
 * Opening and saving a DOCX.
 *
 * The package is kept on the open document for the lifetime of the editing
 * session: saving regenerates `word/document.xml` and writes every other part
 * back from those same buffers, which is what preserves the parts we do not
 * model (`docs/adr/0003-docx-native-roundtrip.md`).
 */

const THEME_PART = 'word/theme/theme1.xml'

export interface OpenDocx {
  /** Held for the session; saving writes it back with one part replaced. */
  pkg: OoxmlPackage
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
  styles: StyleCatalogue
  numbering: NumberingCatalogue
  /** Page size, margins and orientation, plus whatever else `w:sectPr` carried. */
  section: SectionProperties
  /** Notes from `word/footnotes.xml`, keyed by id. */
  footnotes: Map<number, Footnote>
  /** Comments from `word/comments.xml`, keyed by id. */
  comments: Map<number, Comment>
  /** Whether the document records edits as tracked changes. */
  trackChanges: boolean
  /** The scheme numbering the heading styles, or null when they are not. */
  headingNumbering: HeadingNumberScheme | null
  /** Whether the source declared `xml:space` on every run. */
  alwaysPreserveSpace: boolean
  documentAttributes: Record<string, string>
  /** The `w:document` children that are not the body, kept as the file wrote them. */
  documentPrelude: string | null
}

/**
 * The document theme's colour slots as hexes — `accent1` to `#4472C4`.
 *
 * A chart states its colours symbolically and is drawn in whatever the
 * document's theme means by `accent1`, so resolving them once here keeps that
 * lookup out of every repaint. Used when a document is opened and again when a
 * chart is inserted into one.
 */
export function themeColorsOf(pkg: OoxmlPackage): (readonly [string, string])[] {
  const theme = parseTheme(getPartText(pkg, THEME_PART) ?? '')

  return [...theme.colors].flatMap(([slot, color]) => {
    const resolved = resolveColor(color, { scheme: theme.colors, map: new Map() })
    return resolved === null ? [] : [[slot, resolved.hex] as const]
  })
}

export async function openDocx(bytes: Uint8Array): Promise<OpenDocx> {
  const pkg = await readDocxPackage(bytes)

  const theme = parseTheme(getPartText(pkg, THEME_PART) ?? '').fonts
  const relationships = parseRelationships(getPartText(pkg, 'word/_rels/document.xml.rels') ?? '')
  const themeColors = themeColorsOf(pkg)

  /** A chart's part, as text, for the renderer that draws it. */
  const resolveChart = (relationshipId: string): string | null => {
    const relationship = relationships.get(relationshipId)
    if (!relationship || relationship.external) return null
    return getPartText(pkg, resolveTarget(relationship.target, 'word')) ?? null
  }

  // Images are stored as relationship ids; the webview needs something it can
  // put in a `src`, so each one is resolved to a data URL from the media part.
  const resolveImage = (relationshipId: string): string | null => {
    const relationship = relationships.get(relationshipId)
    if (!relationship || relationship.external) return null
    return mediaDataUrl(pkg, resolveTarget(relationship.target, 'word'))
  }

  const footnotes = parseFootnotes(getPartText(pkg, FOOTNOTES_PART) ?? '')
  const footnoteText = (id: number): string => {
    const footnote = footnotes.get(id)
    return footnote === undefined ? '' : readFootnoteText(footnote)
  }

  // Read before the body: a list is a run of paragraphs pointing at a numbering
  // definition, and without the definitions there is no way to tell one from a
  // run of ordinary paragraphs.
  const numbering = parseNumbering(getPartText(pkg, NUMBERING_PART) ?? '')

  const parsed = parseDocument(getPartText(pkg, documentPart(pkg)) ?? '', {
    theme,
    resolveImage,
    resolveChart,
    themeColors,
    footnoteText,
    numbering,
  })

  return {
    pkg,
    doc: parsed.doc,
    warnings: parsed.warnings,
    styles: parseStyles(getPartText(pkg, 'word/styles.xml') ?? ''),
    footnotes,
    comments: readComments(pkg),
    trackChanges: readTrackChanges(pkg),
    alwaysPreserveSpace: parsed.alwaysPreserveSpace,
    numbering,
    headingNumbering: readHeadingNumbering(pkg),
    section: parseSection(parsed.sectionProperties),
    documentAttributes: parsed.documentAttributes,
    documentPrelude: parsed.documentPrelude,
  }
}

export interface SaveDocxOptions {
  /** Page setup, which may have changed since the file was opened. */
  section?: SectionProperties
  /** Undefined leaves whatever the file already says about numbered headings. */
  headingNumbering?: HeadingNumberScheme | null
  /** Undefined keeps the comments the file was opened with. */
  comments?: ReadonlyMap<number, Comment>
  /** Undefined leaves whatever the file says about recording changes. */
  trackChanges?: boolean
}

export async function saveDocx(
  open: OpenDocx,
  doc: ProseMirrorNodeJson,
  options: SaveDocxOptions = {},
): Promise<Uint8Array> {
  // Lists made in the editor need a numbering definition in the package, or
  // Word renders them as plain body text.
  const added: XmlNode[] = []
  const allocate = (kind: 'bullet' | 'ordered'): number => {
    const allocated = allocateNumbering(open.numbering, kind)
    added.push(...allocated.nodes)
    return allocated.numId
  }

  const xml = serializeDocument(doc, {
    documentAttributes: open.documentAttributes,
    documentPrelude: open.documentPrelude,
    // The part as it was read: its declaration and its root come back as they
    // were, and only the body is rebuilt.
    previous: getPartText(open.pkg, documentPart(open.pkg)),
    // Page setup may have changed it since the file was opened.
    sectionProperties: serializeSection(options.section ?? open.section),
    alwaysPreserveSpace: open.alwaysPreserveSpace,
    allocateNumbering: allocate,
    // Captions count within a chapter exactly when the chapters are numbered.
    captionsByChapter: (options.headingNumbering ?? open.headingNumbering) !== null,
  })

  if (added.length > 0) writeNumbering(open.pkg, added)

  // The heading styles carry the numbering, so it is written to the package
  // rather than to the body — see `heading-numbering-session`.
  if (options.headingNumbering !== undefined) {
    const { createdNumberingPart } = writeHeadingNumbering(open.pkg, options.headingNumbering)
    if (createdNumberingPart) declareNumberingPart(open.pkg)
  }

  setPartText(open.pkg, documentPart(open.pkg), xml)
  // A chart is a part of its own, held in the node that draws it so the undo
  // history owns it; here is where the node's copy becomes the file's.
  await writeCharts(open.pkg, doc)
  // Footnotes live in their own part, so they are written alongside the body.
  writeFootnotes(open.pkg, open.footnotes, doc)
  writeComments(open.pkg, options.comments ?? open.comments, doc)
  if (options.trackChanges !== undefined) writeTrackChanges(open.pkg, options.trackChanges)

  return writePackage(open.pkg)
}

/** Every node of a document, in the order they appear. */
function* everyNode(node: ProseMirrorNodeJson): Generator<ProseMirrorNodeJson> {
  yield node
  for (const child of node.content ?? []) yield* everyNode(child)
}

/**
 * Writes each chart's part from the node that holds it.
 *
 * Only where the two differ. A chart nobody edited is left exactly as the file
 * had it — including the parts of `c:chartSpace` we do not model — which is
 * what makes a save of an untouched document produce an untouched file.
 */
async function writeCharts(pkg: OoxmlPackage, doc: ProseMirrorNodeJson): Promise<void> {
  const relationships = parseRelationships(getPartText(pkg, 'word/_rels/document.xml.rels') ?? '')

  for (const node of everyNode(doc)) {
    if (node.type !== 'documentChart') continue

    const id = node.attrs?.['relationshipId']
    const xml = node.attrs?.['chart']
    if (typeof id !== 'string' || typeof xml !== 'string') continue

    const relationship = relationships.get(id)
    if (relationship === undefined || relationship.external) continue

    const path = resolveTarget(relationship.target, 'word')
    if (getPartText(pkg, path) === xml) continue

    setPartText(pkg, path, xml)
    await syncWorkbook(pkg, path, xml)
  }
}

/**
 * Brings the workbook a chart embeds back into step with the chart.
 *
 * A chart says its numbers twice: the cache it is drawn from and the workbook
 * "Edit Data" opens. Word rebuilds the cache from the workbook the moment
 * anybody opens the data, so a chart edited in only one of them loses the edit
 * the first time somebody looks.
 *
 * Done here rather than as the edit happens, because the edit happens in the
 * node — which the undo history owns — and the workbook is a package part,
 * which it does not. Writing both at edit time would make an undone edit come
 * back through the workbook.
 */
async function syncWorkbook(pkg: OoxmlPackage, path: string, xml: string): Promise<void> {
  const chart = readChart(xml)
  if (chart === null) return

  const write = async (change: ChartValues | ChartCategories) => {
    const patched = await patchedWorkbook(pkg, path, change)
    if (patched === null) return

    pkg.parts.set(patched.path, { path: patched.path, bytes: patched.bytes, date: new Date() })
  }

  if (chart.categories.length > 0) await write({ categories: chart.categories })

  for (const [index, series] of allSeries(chart).entries()) {
    await write({ series: index, values: series.values.map((value) => value ?? 0) })
  }
}

/**
 * Adds numbering definitions to the package, creating the part when the
 * document had none — with its relationship and content-type override, without
 * which Word repairs the file.
 */
function writeNumbering(pkg: OoxmlPackage, added: readonly XmlNode[]): void {
  const existing = getPartText(pkg, NUMBERING_PART)
  setPartText(pkg, NUMBERING_PART, mergeNumbering(existing, added))

  if (existing === undefined) declareNumberingPart(pkg)
}

/**
 * Declares a newly created `numbering.xml` in the package.
 *
 * Without the relationship and the content-type override Word repairs the file,
 * so this runs whichever way the part came to exist.
 */
function declareNumberingPart(pkg: OoxmlPackage): void {
  const relationships = parseRelationships(getPartText(pkg, documentRelsPart(pkg)) ?? '')
  if (!findByTarget(relationships, 'numbering.xml')) {
    addRelationship(relationships, NUMBERING_RELATIONSHIP, 'numbering.xml')
    writeRelationships(pkg, documentRelsPart(pkg), relationships)
  }

  const contentTypes = getPartText(pkg, CONTENT_TYPES_PART)
  if (contentTypes !== undefined && !contentTypes.includes('/word/numbering.xml')) {
    const roots = parseXml(contentTypes)
    const types = roots.find((node) => tagName(node) === 'Types')
    const list = types?.['Types']

    if (Array.isArray(list)) {
      list.push(
        element('Override', {
          PartName: `/${NUMBERING_PART}`,
          ContentType: NUMBERING_CONTENT_TYPE,
        }),
      )
      setPartXml(pkg, CONTENT_TYPES_PART, roots)
    }
  }
}

/**
 * The package a brand-new document starts from.
 *
 * A new document is a real DOCX from the first keystroke, so there is never a
 * moment where the app holds something that is not the native format. The
 * template is the minimum Word accepts without offering to repair the file.
 */
export function newDocxTemplate(): Record<string, string> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

  // Defaults match CLAUDE.md's document defaults: Arial 11pt, 1.15 line spacing.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headingStyles()}<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:sz w:val="52"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="666666"/><w:sz w:val="30"/></w:rPr></w:style></w:styles>`

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'word/_rels/document.xml.rels': documentRels,
    'word/document.xml': document,
    'word/styles.xml': styles,
  }
}

function headingStyles(): string {
  const sizes = [32, 26, 24, 22, 22, 22]
  return sizes
    .map((size, index) => {
      const level = index + 1
      return `<w:style w:type="paragraph" w:styleId="Heading${String(level)}"><w:name w:val="heading ${String(level)}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="${String(index)}"/><w:spacing w:before="240" w:after="60"/></w:pPr><w:rPr><w:sz w:val="${String(size)}"/></w:rPr></w:style>`
    })
    .join('')
}

/** Builds the package for a new document, ready to be edited and saved. */
export async function createNewDocx(): Promise<OpenDocx> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  for (const [path, contents] of Object.entries(newDocxTemplate())) {
    zip.file(path, contents)
  }

  return openDocx(await zip.generateAsync({ type: 'uint8array' }))
}
