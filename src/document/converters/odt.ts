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

/** Everything the block walk needs: styles to resolve against, warnings to add to. */
interface OdtContext {
  styles: Map<string, OdtStyle>
  listStyles: Map<string, OdtListStyle>
  warnings: ParseWarning[]
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
const LIST_HEADER_TAG = 'text:list-header'
const TABLE_TAG = 'table:table'
const TABLE_ROW_TAG = 'table:table-row'
const TABLE_CELL_TAG = 'table:table-cell'

/**
 * One level of a list style.
 *
 * ODT puts no type on the list element itself: `<text:list>` names a
 * `<text:list-style>`, and that style declares, per nesting level, whether the
 * marker is a bullet, a number or an image. The level is not written down
 * either — it is how deeply the list is nested.
 */
export interface OdtListLevel {
  kind: 'bulletList' | 'orderedList'
  start: number
}

export type OdtListStyle = Map<number, OdtListLevel>

/** Sections that may declare styles. The body is skipped — lists live there. */
const STYLE_CONTAINERS = new Set([
  'office:automatic-styles',
  'office:styles',
  'office:master-styles',
])

function levelFrom(node: XmlNode): { level: number; definition: OdtListLevel } | null {
  const tag = tagName(node)

  let kind: OdtListLevel['kind']
  if (tag === 'text:list-level-style-number') {
    // An empty number format is how "no marker" is written. Structurally it is
    // still a numbering definition, but nothing is numbered on screen, so the
    // bulleted list is the closer of the two nodes we have.
    kind = (attribute(node, 'style:num-format') ?? '') === '' ? 'bulletList' : 'orderedList'
  } else if (tag === 'text:list-level-style-bullet' || tag === 'text:list-level-style-image') {
    kind = 'bulletList'
  } else {
    return null
  }

  const level = Number.parseInt(attribute(node, 'text:level') ?? '1', 10)
  const start = Number.parseInt(attribute(node, 'text:start-value') ?? '1', 10)

  return {
    level: Number.isFinite(level) && level > 0 ? level : 1,
    definition: { kind, start: Number.isFinite(start) && start > 0 ? start : 1 },
  }
}

function collectListStyles(root: XmlNode, into: Map<string, OdtListStyle>): void {
  for (const section of children(root)) {
    const sectionTag = tagName(section)
    if (sectionTag === null || !STYLE_CONTAINERS.has(sectionTag)) continue

    for (const style of children(section)) {
      if (tagName(style) !== 'text:list-style') continue

      const name = attribute(style, 'style:name')
      if (name === undefined) continue

      const levels: OdtListStyle = new Map()
      for (const child of children(style)) {
        const parsed = levelFrom(child)
        if (parsed) levels.set(parsed.level, parsed.definition)
      }

      if (levels.size > 0) into.set(name, levels)
    }
  }
}

/**
 * List styles declared in `styles.xml`.
 *
 * Word's ODT export puts them there and leaves `content.xml` referencing them
 * by name, so a converter that reads only `content.xml` sees every list as
 * untyped and has to guess.
 */
export function parseOdtListStyles(xml: string): Map<string, OdtListStyle> {
  const styles = new Map<string, OdtListStyle>()

  const root = parseXml(xml).find((node) => tagName(node) === 'office:document-styles')
  if (root) collectListStyles(root, styles)

  return styles
}

/**
 * The list kind for a nesting level.
 *
 * A nested list usually omits `text:style-name` and inherits the outer one, so
 * the name is threaded down rather than read from each element.
 */
function listLevel(
  styles: Map<string, OdtListStyle>,
  styleName: string | null,
  level: number,
): OdtListLevel {
  const style = styleName === null ? undefined : styles.get(styleName)

  // Levels beyond the deepest declared one repeat the last declaration, which
  // is what readers do rather than falling back to a bullet.
  const declared = style?.get(level) ?? lastLevel(style)
  if (declared) return declared

  // No definition anywhere in the package: LibreOffice names ordered lists
  // after the numbering they use, which is the only signal left.
  const ordered = styleName !== null && /num/iu.test(styleName)
  return { kind: ordered ? 'orderedList' : 'bulletList', start: 1 }
}

function lastLevel(style: OdtListStyle | undefined): OdtListLevel | undefined {
  if (!style || style.size === 0) return undefined

  let deepest: OdtListLevel | undefined
  let deepestLevel = 0
  for (const [level, definition] of style) {
    if (level > deepestLevel) {
      deepestLevel = level
      deepest = definition
    }
  }

  return deepest
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

/**
 * A list and everything nested inside it.
 *
 * `level` is the nesting depth, which is what selects the level definition in
 * the list style; `inheritedName` carries the outer list's style down, because
 * a nested `<text:list>` normally names none.
 */
function parseList(
  node: XmlNode,
  ctx: OdtContext,
  level: number,
  inheritedName: string | null,
): ProseMirrorNodeJson {
  const styleName = attribute(node, 'text:style-name') ?? inheritedName
  const definition = listLevel(ctx.listStyles, styleName, level)

  const items = children(node)
    .filter((child) => {
      const tag = tagName(child)
      // A list header holds the text that precedes the first numbered item.
      // There is no node for it, so it becomes an ordinary item rather than
      // being dropped along with its content.
      return tag === LIST_ITEM_TAG || tag === LIST_HEADER_TAG
    })
    .map((item) => ({
      type: 'listItem',
      content: children(item).flatMap((child) =>
        parseBlock(child, ctx, { level: level + 1, styleName }),
      ),
    }))

  // Word restarts a list by putting the number on the first item rather than in
  // the style, so the item overrides the level's own start value.
  const firstItem = children(node).find((child) => tagName(child) === LIST_ITEM_TAG)
  const override = Number.parseInt(
    (firstItem === undefined ? undefined : attribute(firstItem, 'text:start-value')) ?? '',
    10,
  )
  const start = Number.isFinite(override) && override > 0 ? override : definition.start

  return {
    type: definition.kind,
    ...(definition.kind === 'orderedList' && start !== 1 ? { attrs: { start } } : {}),
    content: items.length > 0 ? items : [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
  }
}

/** A table. ODT has no grid element, so column widths come from the styles. */
function parseOdtTable(node: XmlNode, ctx: OdtContext): ProseMirrorNodeJson {
  const rows = children(node)
    .filter((child) => tagName(child) === TABLE_ROW_TAG)
    .map((row) => ({
      type: 'tableRow',
      content: children(row)
        .filter((cell) => tagName(cell) === TABLE_CELL_TAG)
        .map((cell) => {
          const span = Number.parseInt(attribute(cell, 'table:number-columns-spanned') ?? '1', 10)
          const rowSpan = Number.parseInt(attribute(cell, 'table:number-rows-spanned') ?? '1', 10)
          const content = children(cell).flatMap((child) => parseBlock(child, ctx))

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
  ctx: OdtContext,
  nested?: { level: number; styleName: string | null },
): ProseMirrorNodeJson[] {
  const tag = tagName(node)
  if (tag === null || isTextNode(node)) return []

  if (tag === PARAGRAPH_TAG || tag === HEADING_TAG) {
    const inline = children(node).flatMap((child) => inlineFrom(child, ctx.styles, [], ctx.warnings))

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

  if (tag === LIST_TAG) {
    return [parseList(node, ctx, nested?.level ?? 1, nested?.styleName ?? null)]
  }
  if (tag === TABLE_TAG) return [parseOdtTable(node, ctx)]

  ctx.warnings.push({ tag, message: `<${tag}> is preserved but cannot be edited yet.` })
  return [{ type: 'passthroughBlock', attrs: { xml: serializeNode(node), tag } }]
}

export function parseOdtContent(
  xml: string,
  options: { listStyles?: Map<string, OdtListStyle> } = {},
): {
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

  // Styles from the package come first; a list style redeclared in content.xml
  // is an automatic style and overrides the named one it is based on.
  const listStyles = new Map(options.listStyles ?? [])
  collectListStyles(root, listStyles)

  const ctx: OdtContext = { styles: parseAutomaticStyles(root), listStyles, warnings }
  const automatic = children(root).find((node) => tagName(node) === 'office:automatic-styles')

  const body = children(root).find((node) => tagName(node) === 'office:body')
  const text = body ? children(body).find((node) => tagName(node) === 'office:text') : undefined

  const content = (text ? children(text) : []).flatMap((node) => parseBlock(node, ctx))

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

const BULLET_NAME = 'OD_Bullet'
const NUMBER_NAME = 'OD_Number'

/** How far each level is indented, in centimetres — LibreOffice's own step. */
const INDENT_STEP = 0.635
const LEVELS = 9

/** The bullet characters Word and LibreOffice cycle through by depth. */
const BULLET_CHARS = ['\u2022', '\u25E6', '\u25AA']

/**
 * A list style covering every level.
 *
 * Written even when the document only nests one deep: the reference has to
 * resolve, and a `<text:list>` naming a style that was never declared renders
 * without any marker at all.
 */
function buildListStyle(name: string): XmlNode {
  const ordered = name === NUMBER_NAME

  const levels = Array.from({ length: LEVELS }, (_unused, index) => {
    const level = index + 1
    const indent = `${(INDENT_STEP * level).toFixed(3)}cm`

    const properties = element('style:list-level-properties', {
      'text:space-before': indent,
      'text:min-label-width': `${INDENT_STEP.toFixed(3)}cm`,
    })

    if (ordered) {
      return element(
        'text:list-level-style-number',
        {
          'text:level': String(level),
          'style:num-suffix': '.',
          'style:num-format': '1',
        },
        [properties],
      )
    }

    return element(
      'text:list-level-style-bullet',
      {
        'text:level': String(level),
        'text:bullet-char': BULLET_CHARS[index % BULLET_CHARS.length] ?? '\u2022',
      },
      [properties],
    )
  })

  return element('text:list-style', { 'style:name': name }, levels)
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
  const usedLists = new Set<string>()

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
      case 'orderedList': {
        // The style name carries the bullet-versus-number distinction, which is
        // where ODT keeps it; the style itself is declared alongside.
        const name = node.type === 'orderedList' ? NUMBER_NAME : BULLET_NAME
        usedLists.add(name)

        const start = node.attrs?.['start']
        const items = node.content ?? []

        return [
          element(
            LIST_TAG,
            { 'text:style-name': name },
            items.map((item, index) =>
              element(
                LIST_ITEM_TAG,
                // A list that does not start at one says so on its first item,
                // which is how a restart is written.
                index === 0 && typeof start === 'number' && start !== 1
                  ? { 'text:start-value': String(start) }
                  : {},
                (item.content ?? []).flatMap(serializeBlock),
              ),
            ),
          ),
        ]
      }

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
    element('office:automatic-styles', {}, [
      ...[...used].sort().map(buildTextProperties),
      ...[...usedLists].sort().map(buildListStyle),
    ]),
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

  const stylesXml = parts.get(STYLES_PART)?.text
  const parsed = parseOdtContent(contentXml, {
    ...(stylesXml === undefined ? {} : { listStyles: parseOdtListStyles(stylesXml) }),
  })

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
