import { parseThemeFonts } from '../ooxml/fonts'
import {
  CONTENT_TYPES_PART,
  DOCUMENT_PART,
  getPartText,
  NUMBERING_PART,
  readPackage,
  setPartText,
  writePackage,
} from '../ooxml/package'
import type { DocxPackage } from '../ooxml/package'
import { parseNumbering } from '../ooxml/numbering'
import {
  allocateNumbering,
  mergeNumbering,
  NUMBERING_CONTENT_TYPE,
  NUMBERING_RELATIONSHIP,
} from '../ooxml/numbering-builder'
import { buildXml, element, parseXml, tagName, withDeclaration } from '../ooxml/xml'
import type { XmlNode } from '../ooxml/xml'
import { addRelationship, findByTarget, serializeRelationships } from '../ooxml/relationships'
import { DOCUMENT_RELS_PART } from './media'
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
import { parseRelationships, resolveTarget } from '../ooxml/relationships'
import { mediaDataUrl } from './media'
import type { Footnote } from '../ooxml/footnotes'
import { writeFootnotes } from './footnotes-session'
import { parseSection, serializeSection } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import { serializeDocument } from '../ooxml/serialize-document'
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
  pkg: DocxPackage
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
  styles: StyleCatalogue
  numbering: NumberingCatalogue
  /** Page size, margins and orientation, plus whatever else `w:sectPr` carried. */
  section: SectionProperties
  /** Notes from `word/footnotes.xml`, keyed by id. */
  footnotes: Map<number, Footnote>
  /** The scheme numbering the heading styles, or null when they are not. */
  headingNumbering: HeadingNumberScheme | null
  /** Whether the source declared `xml:space` on every run. */
  alwaysPreserveSpace: boolean
  documentAttributes: Record<string, string>
}

export async function openDocx(bytes: Uint8Array): Promise<OpenDocx> {
  const pkg = await readPackage(bytes)

  const theme = parseThemeFonts(getPartText(pkg, THEME_PART) ?? '')
  const relationships = parseRelationships(getPartText(pkg, 'word/_rels/document.xml.rels') ?? '')

  // Images are stored as relationship ids; the webview needs something it can
  // put in a `src`, so each one is resolved to a data URL from the media part.
  const resolveImage = (relationshipId: string): string | null => {
    const relationship = relationships.get(relationshipId)
    if (!relationship || relationship.external) return null
    return mediaDataUrl(pkg, resolveTarget(relationship.target))
  }

  const footnotes = parseFootnotes(getPartText(pkg, FOOTNOTES_PART) ?? '')
  const footnoteText = (id: number): string => {
    const footnote = footnotes.get(id)
    return footnote === undefined ? '' : readFootnoteText(footnote)
  }

  const parsed = parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '', {
    theme,
    resolveImage,
    footnoteText,
  })

  return {
    pkg,
    doc: parsed.doc,
    warnings: parsed.warnings,
    styles: parseStyles(getPartText(pkg, 'word/styles.xml') ?? ''),
    footnotes,
    alwaysPreserveSpace: parsed.alwaysPreserveSpace,
    numbering: parseNumbering(getPartText(pkg, 'word/numbering.xml') ?? ''),
    headingNumbering: readHeadingNumbering(pkg),
    section: parseSection(parsed.sectionProperties),
    documentAttributes: parsed.documentAttributes,
  }
}

export interface SaveDocxOptions {
  /** Page setup, which may have changed since the file was opened. */
  section?: SectionProperties
  /** Undefined leaves whatever the file already says about numbered headings. */
  headingNumbering?: HeadingNumberScheme | null
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

  setPartText(open.pkg, DOCUMENT_PART, xml)
  // Footnotes live in their own part, so they are written alongside the body.
  writeFootnotes(open.pkg, open.footnotes, doc)

  return writePackage(open.pkg)
}

/**
 * Adds numbering definitions to the package, creating the part when the
 * document had none — with its relationship and content-type override, without
 * which Word repairs the file.
 */
function writeNumbering(pkg: DocxPackage, added: readonly XmlNode[]): void {
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
function declareNumberingPart(pkg: DocxPackage): void {
  const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
  if (!findByTarget(relationships, 'numbering.xml')) {
    addRelationship(relationships, NUMBERING_RELATIONSHIP, 'numbering.xml')
    setPartText(pkg, DOCUMENT_RELS_PART, serializeRelationships(relationships))
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
      setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(buildXml(roots)))
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
