import JSZip from 'jszip'
import {
  attribute,
  buildXml,
  children,
  element,
  parseXml,
  serializeNode,
  tagName,
  textNode,
  textValue,
  isTextNode,
} from '../../ooxml/xml'
import type { XmlNode } from '../../ooxml/xml'
import { docOf, markNames } from './types'
import type { ParseWarning, ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * OpenDocument Text.
 *
 * Same strategy as DOCX (`docs/adr/0003-docx-native-roundtrip.md`): the package
 * is held as read and only `content.xml` is regenerated, with unmodelled
 * elements kept verbatim as passthrough. ODT differs in one structural way —
 * formatting lives in named *automatic styles* declared in the same file rather
 * than inline, so a run's formatting is a style reference that has to be looked
 * up.
 */

export const CONTENT_PART = 'content.xml'
export const STYLES_PART = 'styles.xml'

export interface OdtPackage {
  parts: Map<string, { bytes: Uint8Array; text?: string }>
}

export interface OpenOdt {
  pkg: OdtPackage
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
  /** Automatic styles declared in content.xml, kept for rebuilding references. */
  automaticStyles: string | null
  contentAttributes: Record<string, string>
}

/** Style properties we model; anything else keeps the style reference as-is. */
interface OdtStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

const HEADING_TAG = 'text:h'
const PARAGRAPH_TAG = 'text:p'
const LIST_TAG = 'text:list'
const LIST_ITEM_TAG = 'text:list-item'
const TABLE_TAG = 'table:table'
const TABLE_ROW_TAG = 'table:table-row'
const TABLE_CELL_TAG = 'table:table-cell'

/**
 * ODT does not distinguish bulleted from numbered lists on the list element —
 * the distinction lives in the list style it names. Without reading styles.xml
 * we cannot tell, and guessing wrong turns every numbered list into bullets. A
 * name containing a digit is how LibreOffice writes ordered lists, which is the
 * best signal available from content.xml alone.
 */
function listKind(node: XmlNode): 'bulletList' | 'orderedList' {
  const styleName = attribute(node, 'text:style-name') ?? ''
  return /^(L|WWNum)\d+$/u.test(styleName) && /num/iu.test(styleName) ? 'orderedList' : 'bulletList'
}

function parseAutomaticStyles(root: XmlNode): Map<string, OdtStyle> {
  const styles = new Map<string, OdtStyle>()

  const automatic = children(root).find((node) => tagName(node) === 'office:automatic-styles')
  if (!automatic) return styles

  for (const style of children(automatic)) {
    if (tagName(style) !== 'style:style') continue

    const name = attribute(style, 'style:name')
    if (name === undefined) continue

    const properties = children(style).find((node) => tagName(node) === 'style:text-properties')
    if (!properties) continue

    styles.set(name, {
      bold: attribute(properties, 'fo:font-weight') === 'bold',
      italic: attribute(properties, 'fo:font-style') === 'italic',
      underline: attribute(properties, 'style:text-underline-style') !== undefined,
      strike: attribute(properties, 'style:text-line-through-style') !== undefined,
    })
  }

  return styles
}

function marksFor(style: OdtStyle | undefined): { type: string }[] {
  if (!style) return []
  const marks: { type: string }[] = []
  if (style.bold) marks.push({ type: 'bold' })
  if (style.italic) marks.push({ type: 'italic' })
  if (style.underline) marks.push({ type: 'underline' })
  if (style.strike) marks.push({ type: 'strike' })
  return marks
}

function inlineFrom(
  node: XmlNode,
  styles: Map<string, OdtStyle>,
  inherited: { type: string }[],
  warnings: ParseWarning[],
): ProseMirrorNodeJson[] {
  if (isTextNode(node)) {
    const text = textValue(node)
    return text === ''
      ? []
      : [{ type: 'text', text, ...(inherited.length > 0 ? { marks: [...inherited] } : {}) }]
  }

  const tag = tagName(node)

  switch (tag) {
    case 'text:span': {
      const styleName = attribute(node, 'text:style-name')
      const marks = [
        ...inherited,
        ...marksFor(styleName === undefined ? undefined : styles.get(styleName)),
      ]
      return children(node).flatMap((child) => inlineFrom(child, styles, marks, warnings))
    }
    case 'text:s': {
      // An explicit run of spaces; ODT collapses literal whitespace otherwise.
      const count = Number.parseInt(attribute(node, 'text:c') ?? '1', 10)
      return [{ type: 'text', text: ' '.repeat(Number.isFinite(count) ? count : 1) }]
    }
    case 'text:tab':
      return [{ type: 'text', text: '\t' }]
    case 'text:line-break':
      return [{ type: 'hardBreak' }]
    case 'text:a': {
      const href = attribute(node, 'xlink:href')
      const marks = href === undefined ? inherited : [...inherited, { type: 'link' }]
      const inner = children(node).flatMap((child) => inlineFrom(child, styles, marks, warnings))
      if (href !== undefined) {
        for (const item of inner) {
          const link = item.marks?.find((mark) => mark.type === 'link')
          if (link) link.attrs = { href }
        }
      }
      return inner
    }
    default:
      if (tag === null) return []
      warnings.push({ tag, message: `<${tag}> is preserved but not editable.` })
      return [{ type: 'passthroughInline', attrs: { xml: serializeNode(node), tag } }]
  }
}

/** A list and everything nested inside it. */
function parseList(
  node: XmlNode,
  styles: Map<string, OdtStyle>,
  warnings: ParseWarning[],
): ProseMirrorNodeJson {
  const items = children(node)
    .filter((child) => tagName(child) === LIST_ITEM_TAG)
    .map((item) => ({
      type: 'listItem',
      content: children(item).flatMap((child) => parseBlock(child, styles, warnings)),
    }))

  return {
    type: listKind(node),
    content: items.length > 0 ? items : [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
  }
}

/** A table. ODT has no grid element, so column widths come from the styles. */
function parseOdtTable(
  node: XmlNode,
  styles: Map<string, OdtStyle>,
  warnings: ParseWarning[],
): ProseMirrorNodeJson {
  const rows = children(node)
    .filter((child) => tagName(child) === TABLE_ROW_TAG)
    .map((row) => ({
      type: 'tableRow',
      content: children(row)
        .filter((cell) => tagName(cell) === TABLE_CELL_TAG)
        .map((cell) => {
          const span = Number.parseInt(attribute(cell, 'table:number-columns-spanned') ?? '1', 10)
          const rowSpan = Number.parseInt(attribute(cell, 'table:number-rows-spanned') ?? '1', 10)
          const content = children(cell).flatMap((child) => parseBlock(child, styles, warnings))

          return {
            type: 'tableCell',
            attrs: {
              colspan: Number.isFinite(span) && span > 0 ? span : 1,
              rowspan: Number.isFinite(rowSpan) && rowSpan > 0 ? rowSpan : 1,
            },
            // A cell must hold at least one block, as in OOXML.
            content: content.length > 0 ? content : [{ type: 'paragraph' }],
          }
        }),
    }))

  return {
    type: 'table',
    content: rows.length > 0 ? rows : [{ type: 'tableRow', content: [] }],
  }
}

/** One block of body content: paragraph, heading, list, table or passthrough. */
function parseBlock(
  node: XmlNode,
  styles: Map<string, OdtStyle>,
  warnings: ParseWarning[],
): ProseMirrorNodeJson[] {
  const tag = tagName(node)
  if (tag === null || isTextNode(node)) return []

  if (tag === PARAGRAPH_TAG || tag === HEADING_TAG) {
    const inline = children(node).flatMap((child) => inlineFrom(child, styles, [], warnings))

    if (tag === HEADING_TAG) {
      const level = Number.parseInt(attribute(node, 'text:outline-level') ?? '1', 10)
      return [
        {
          type: 'heading',
          attrs: { level: Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1 },
          ...(inline.length > 0 ? { content: inline } : {}),
        },
      ]
    }

    return [{ type: 'paragraph', ...(inline.length > 0 ? { content: inline } : {}) }]
  }

  if (tag === LIST_TAG) return [parseList(node, styles, warnings)]
  if (tag === TABLE_TAG) return [parseOdtTable(node, styles, warnings)]

  warnings.push({ tag, message: `<${tag}> is preserved but cannot be edited yet.` })
  return [{ type: 'passthroughBlock', attrs: { xml: serializeNode(node), tag } }]
}

export function parseOdtContent(xml: string): {
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
  automaticStyles: string | null
  contentAttributes: Record<string, string>
} {
  const warnings: ParseWarning[] = []
  const root = parseXml(xml).find((node) => tagName(node) === 'office:document-content')

  if (!root) {
    return {
      doc: docOf([]),
      warnings: [{ tag: 'office:document-content', message: 'content.xml has no document root.' }],
      automaticStyles: null,
      contentAttributes: {},
    }
  }

  const styles = parseAutomaticStyles(root)
  const automatic = children(root).find((node) => tagName(node) === 'office:automatic-styles')

  const body = children(root).find((node) => tagName(node) === 'office:body')
  const text = body ? children(body).find((node) => tagName(node) === 'office:text') : undefined

  const content: ProseMirrorNodeJson[] = []

  for (const node of text ? children(text) : []) {
    const tag = tagName(node)

    if (tag === PARAGRAPH_TAG || tag === HEADING_TAG) {
      const inline = children(node).flatMap((child) => inlineFrom(child, styles, [], warnings))

      if (tag === HEADING_TAG) {
        const level = Number.parseInt(attribute(node, 'text:outline-level') ?? '1', 10)
        content.push({
          type: 'heading',
          attrs: { level: Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1 },
          ...(inline.length > 0 ? { content: inline } : {}),
        })
      } else {
        content.push({ type: 'paragraph', ...(inline.length > 0 ? { content: inline } : {}) })
      }
      continue
    }

    if (tag === LIST_TAG) {
      content.push(parseList(node, styles, warnings))
      continue
    }

    if (tag === TABLE_TAG) {
      content.push(parseOdtTable(node, styles, warnings))
      continue
    }

    if (tag === null || isTextNode(node)) continue

    warnings.push({ tag, message: `<${tag}> is preserved but cannot be edited yet.` })
    content.push({ type: 'passthroughBlock', attrs: { xml: serializeNode(node), tag } })
  }

  const attributes: Record<string, string> = {}
  const raw = root[':@']
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      attributes[key.replace(/^@_/u, '')] = String(value)
    }
  }

  return {
    doc: docOf(content),
    warnings,
    automaticStyles: automatic ? serializeNode(automatic) : null,
    contentAttributes: attributes,
  }
}

/** Style names for the mark combinations the document actually uses. */
function styleNameFor(marks: Set<string>): string | null {
  const parts: string[] = []
  if (marks.has('bold')) parts.push('B')
  if (marks.has('italic')) parts.push('I')
  if (marks.has('underline')) parts.push('U')
  if (marks.has('strike')) parts.push('S')
  return parts.length > 0 ? `OD_${parts.join('')}` : null
}

function buildTextProperties(name: string): XmlNode {
  const attributes: Record<string, string> = {}
  if (name.includes('B')) attributes['fo:font-weight'] = 'bold'
  if (name.includes('I')) attributes['fo:font-style'] = 'italic'
  if (name.includes('U')) attributes['style:text-underline-style'] = 'solid'
  if (name.includes('S')) attributes['style:text-line-through-style'] = 'solid'

  return element('style:style', { 'style:name': name, 'style:family': 'text' }, [
    element('style:text-properties', attributes),
  ])
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[], used: Set<string>): XmlNode[] {
  return nodes.flatMap((node): XmlNode[] => {
    if (node.type === 'hardBreak') return [element('text:line-break')]
    if (node.type === 'passthroughInline') {
      const xml = node.attrs?.['xml']
      return typeof xml === 'string' ? parseXml(xml) : []
    }
    if (node.type !== 'text') return []

    const marks = markNames(node)
    const styleName = styleNameFor(marks)
    if (styleName !== null) used.add(styleName)

    const text = textNode(node.text ?? '')
    const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.['href']

    let wrapped: XmlNode =
      styleName === null ? text : element('text:span', { 'text:style-name': styleName }, [text])

    if (typeof href === 'string') {
      wrapped = element('text:a', { 'xlink:href': href, 'xlink:type': 'simple' }, [wrapped])
    }

    return [wrapped]
  })
}

export function serializeOdtContent(
  doc: ProseMirrorNodeJson,
  options: { contentAttributes: Record<string, string> },
): string {
  const used = new Set<string>()

  const serializeBlock = (node: ProseMirrorNodeJson): XmlNode[] => {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.['level']
        return [
          element(
            HEADING_TAG,
            {
              'text:style-name': `Heading_20_${String(typeof level === 'number' ? level : 1)}`,
              'text:outline-level': String(typeof level === 'number' ? level : 1),
            },
            serializeInline(node.content ?? [], used),
          ),
        ]
      }
      case 'paragraph':
        return [
          element(
            PARAGRAPH_TAG,
            { 'text:style-name': 'Standard' },
            serializeInline(node.content ?? [], used),
          ),
        ]
      case 'bulletList':
      case 'orderedList':
        return [
          element(
            LIST_TAG,
            // The style name carries the bullet-versus-number distinction, which
            // is where ODT keeps it.
            { 'text:style-name': node.type === 'orderedList' ? 'LNum1' : 'L1' },
            (node.content ?? []).map((item) =>
              element(LIST_ITEM_TAG, {}, (item.content ?? []).flatMap(serializeBlock)),
            ),
          ),
        ]

      case 'table': {
        const rows = node.content ?? []
        const columns = Math.max(
          0,
          ...rows.map((row) =>
            (row.content ?? []).reduce((total, cell) => {
              const span = cell.attrs?.['colspan']
              return total + (typeof span === 'number' ? span : 1)
            }, 0),
          ),
        )

        return [
          element('table:table', { 'table:name': 'Table1' }, [
            // ODT declares columns explicitly rather than as a grid of widths.
            element('table:table-column', {
              'table:number-columns-repeated': String(Math.max(1, columns)),
            }),
            ...rows.map((row) =>
              element(
                TABLE_ROW_TAG,
                {},
                (row.content ?? []).map((cell) => {
                  const colspan = cell.attrs?.['colspan']
                  const rowspan = cell.attrs?.['rowspan']
                  const content = (cell.content ?? []).flatMap(serializeBlock)

                  return element(
                    TABLE_CELL_TAG,
                    {
                      ...(typeof colspan === 'number' && colspan > 1
                        ? { 'table:number-columns-spanned': String(colspan) }
                        : {}),
                      ...(typeof rowspan === 'number' && rowspan > 1
                        ? { 'table:number-rows-spanned': String(rowspan) }
                        : {}),
                    },
                    // A cell must hold at least one paragraph.
                    content.length > 0 ? content : [element(PARAGRAPH_TAG)],
                  )
                }),
              ),
            ),
          ]),
        ]
      }

      case 'passthroughBlock': {
        const xml = node.attrs?.['xml']
        return typeof xml === 'string' ? parseXml(xml) : []
      }
      default:
        return []
    }
  }

  const body: XmlNode[] = (doc.content ?? []).flatMap(serializeBlock)

  const attributes =
    Object.keys(options.contentAttributes).length > 0
      ? options.contentAttributes
      : {
          'xmlns:office': 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
          'xmlns:text': 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
          'xmlns:style': 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
          'xmlns:fo': 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
          'xmlns:xlink': 'http://www.w3.org/1999/xlink',
          'office:version': '1.3',
        }

  const root = element('office:document-content', attributes, [
    element('office:automatic-styles', {}, [...used].sort().map(buildTextProperties)),
    element('office:body', {}, [element('office:text', {}, body)]),
  ])

  return `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml([root])}`
}

export async function openOdt(bytes: Uint8Array): Promise<OpenOdt> {
  const zip = await JSZip.loadAsync(bytes)
  const parts = new Map<string, { bytes: Uint8Array; text?: string }>()

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path]
    if (!entry || entry.dir) continue

    const partBytes = await entry.async('uint8array')
    const isText = /\.(xml|rdf)$/iu.test(path) || path === 'mimetype'
    parts.set(path, {
      bytes: partBytes,
      ...(isText ? { text: new TextDecoder().decode(partBytes) } : {}),
    })
  }

  const contentXml = parts.get(CONTENT_PART)?.text
  if (contentXml === undefined) {
    throw new Error(`not an ODT package: ${CONTENT_PART} is missing`)
  }

  const parsed = parseOdtContent(contentXml)

  return {
    pkg: { parts },
    doc: parsed.doc,
    warnings: parsed.warnings,
    automaticStyles: parsed.automaticStyles,
    contentAttributes: parsed.contentAttributes,
  }
}

export async function saveOdt(open: OpenOdt, doc: ProseMirrorNodeJson): Promise<Uint8Array> {
  const xml = serializeOdtContent(doc, { contentAttributes: open.contentAttributes })
  const encoded = new TextEncoder().encode(xml)
  open.pkg.parts.set(CONTENT_PART, { bytes: encoded, text: xml })

  const zip = new JSZip()
  for (const [path, part] of open.pkg.parts) {
    // `mimetype` must be first and uncompressed, or readers reject the package.
    zip.file(path, part.text === undefined ? part.bytes : new TextEncoder().encode(part.text), {
      compression: path === 'mimetype' ? 'STORE' : 'DEFLATE',
    })
  }

  return zip.generateAsync({ type: 'uint8array' })
}
