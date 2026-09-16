import JSZip from 'jszip'
import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  parseXml,
  serializeNode,
  tagName,
  textNode,
  textValue,
  isTextNode,
} from '../../ooxml/xml'
import type { XmlNode } from '../../ooxml/xml'
import { dataUrlFrom } from '../data-url'
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
export const MANIFEST_PART = 'META-INF/manifest.xml'
export const MIMETYPE_PART = 'mimetype'
export const ODT_MIME_TYPE = 'application/vnd.oasis.opendocument.text'
/** Where an ODT keeps its pictures, the way `word/media/` works in a DOCX. */
export const PICTURES_FOLDER = 'Pictures/'

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
  paragraphStyles: Map<string, OdtParagraphStyle>
  listStyles: Map<string, OdtListStyle>
  graphicStyles: Map<string, OdtGraphicStyle>
  warnings: ParseWarning[]
  /** Turns a package path such as `Pictures/a.png` into something displayable. */
  resolveImage?: ((href: string) => string | null) | undefined
}

/** Style properties we model; anything else keeps the style reference as-is. */
interface OdtStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string | null
  highlight: string | null
  fontFamily: string | null
  /** In points, which is what the editor and both document formats use. */
  fontSize: number | null
}

/** The paragraph properties we model. */
interface OdtParagraphStyle {
  textAlign: string | null
}

/** ODF names the edges of the text rather than the sides of the page. */
function alignmentFrom(value: string | undefined): string | null {
  switch (value) {
    case 'center':
      return 'center'
    case 'end':
    case 'right':
      return 'right'
    case 'start':
    case 'left':
      return 'left'
    case 'justify':
      return 'justify'
    default:
      return null
  }
}

function alignmentTo(value: string): string {
  return value === 'right' ? 'end' : value === 'left' ? 'start' : value
}

/** A colour as the editor holds it, or null when the document says "none". */
function odfColor(value: string | undefined): string | null {
  if (value === undefined || value === '' || value === 'transparent') return null
  return /^#[0-9a-f]{6}$/iu.test(value) ? value.toUpperCase() : null
}

const HEADING_TAG = 'text:h'
const PARAGRAPH_TAG = 'text:p'
const LIST_TAG = 'text:list'
const LIST_ITEM_TAG = 'text:list-item'
const LIST_HEADER_TAG = 'text:list-header'
const TABLE_TAG = 'table:table'
const TABLE_ROW_TAG = 'table:table-row'
const TABLE_CELL_TAG = 'table:table-cell'
const FRAME_TAG = 'draw:frame'
const IMAGE_TAG = 'draw:image'

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

/**
 * Points per unit for the lengths ODF allows.
 *
 * XSL-FO lengths, so a frame can be sized in any of them; `px` is defined
 * against the 96 dpi CSS reference pixel rather than the screen.
 */
const POINTS_PER_UNIT: Record<string, number> = {
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pt: 1,
  pc: 12,
  px: 0.75,
}

export function lengthToPoints(value: string | undefined): number | null {
  if (value === undefined) return null

  const match = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/iu.exec(value)
  if (!match?.[1]) return null

  const amount = Number.parseFloat(match[1])
  if (!Number.isFinite(amount)) return null

  // A bare number is not a valid ODF length; treating it as points is closer
  // than discarding the size and rendering the image at its natural one.
  const factor = POINTS_PER_UNIT[(match[2] ?? '').toLowerCase()] ?? 1
  return Math.round(amount * factor * 100) / 100
}

/** The frame properties that decide where a picture sits relative to the text. */
interface OdtGraphicStyle {
  wrap: string | null
  horizontalPosition: string | null
}

function parseGraphicStyles(root: XmlNode): Map<string, OdtGraphicStyle> {
  const styles = new Map<string, OdtGraphicStyle>()

  for (const section of children(root)) {
    const sectionTag = tagName(section)
    if (sectionTag === null || !STYLE_CONTAINERS.has(sectionTag)) continue

    for (const style of children(section)) {
      if (tagName(style) !== 'style:style') continue
      if (attribute(style, 'style:family') !== 'graphic') continue

      const name = attribute(style, 'style:name')
      if (name === undefined) continue

      const properties = children(style).find(
        (node) => tagName(node) === 'style:graphic-properties',
      )

      styles.set(name, {
        wrap: (properties === undefined ? undefined : attribute(properties, 'style:wrap')) ?? null,
        horizontalPosition:
          (properties === undefined ? undefined : attribute(properties, 'style:horizontal-pos')) ??
          null,
      })
    }
  }

  return styles
}

/**
 * Where a frame sits, as the editor models it.
 *
 * ODF names the side the *text* may occupy, which is the opposite of the side
 * the image floats to — the same inversion DrawingML's `wrapText` has. Frames
 * drawn behind or in front of the text have no equivalent and return null, so
 * they stay preserved rather than being dropped into the flow.
 */
function frameWrap(node: XmlNode, ctx: OdtContext): 'inline' | 'left' | 'right' | 'topAndBottom' | null {
  const anchor = attribute(node, 'text:anchor-type') ?? 'paragraph'
  if (anchor === 'as-char') return 'inline'
  if (anchor === 'page' || anchor === 'frame') return null

  const styleName = attribute(node, 'draw:style-name')
  const style = styleName === undefined ? undefined : ctx.graphicStyles.get(styleName)

  switch (style?.wrap) {
    case 'none':
      return 'topAndBottom'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
    case 'run-through':
      return null
    default: {
      // `parallel` and `dynamic` let text run down both sides, which CSS floats
      // cannot do; the frame's own alignment is the closest single side.
      const position = style?.horizontalPosition
      return position === 'right' ? 'right' : 'left'
    }
  }
}

/** Text of an `svg:title` or `svg:desc` child, which is where alt text lives. */
function describedBy(node: XmlNode, tag: string): string | null {
  const child = children(node).find((candidate) => tagName(candidate) === tag)
  if (!child) return null

  const text = children(child)
    .map((part) => (isTextNode(part) ? textValue(part) : ''))
    .join('')
    .trim()

  return text === '' ? null : text
}

/**
 * A picture frame.
 *
 * Returns null for anything that is not a plain embedded image — an OLE object,
 * a text box, a linked picture — so the caller preserves it verbatim.
 */
function parseFrame(node: XmlNode, ctx: OdtContext): ProseMirrorNodeJson | null {
  const picture = children(node).find((child) => tagName(child) === IMAGE_TAG)
  if (!picture) return null

  const href = attribute(picture, 'xlink:href')
  // A frame holding the bytes inline as `office:binary-data` has no href; so
  // does one linking to a file outside the package.
  if (href === undefined || href === '' || /^[a-z]+:\/\//iu.test(href)) return null

  const wrap = frameWrap(node, ctx)
  if (wrap === null) return null

  const width = lengthToPoints(attribute(node, 'svg:width'))
  const height = lengthToPoints(attribute(node, 'svg:height'))
  const alt = describedBy(node, 'svg:desc') ?? describedBy(node, 'svg:title') ?? ''

  return {
    type: 'image',
    attrs: {
      src: ctx.resolveImage?.(href) ?? '',
      alt,
      width: width ?? 0,
      height: height ?? 0,
      wrap,
      href,
      // Kept so a picture nobody touched is written back as it was read; the
      // recorded width and wrap say whether either has since changed.
      frame: serializeNode(node),
      drawingWidth: width ?? 0,
      drawingWrap: wrap,
    },
  }
}

/**
 * The named styles a run or paragraph can point at.
 *
 * ODT keeps formatting in styles declared beside the body rather than on the
 * element, so every property has to be looked up by name. Both the automatic
 * styles a writer generates per document and the named ones count.
 */
function parseTextStyles(root: XmlNode): {
  text: Map<string, OdtStyle>
  paragraph: Map<string, OdtParagraphStyle>
} {
  const text = new Map<string, OdtStyle>()
  const paragraph = new Map<string, OdtParagraphStyle>()

  // A font name points at a declaration rather than naming the family, so the
  // declarations are read first.
  const fonts = new Map<string, string>()
  for (const section of children(root)) {
    if (tagName(section) !== 'office:font-face-decls') continue
    for (const face of children(section)) {
      const name = attribute(face, 'style:name')
      const family = attribute(face, 'svg:font-family') ?? name
      if (name !== undefined && family !== undefined) fonts.set(name, family.replace(/^'|'$/gu, ''))
    }
  }

  for (const section of children(root)) {
    const sectionTag = tagName(section)
    if (sectionTag === null || !STYLE_CONTAINERS.has(sectionTag)) continue

    for (const style of children(section)) {
      if (tagName(style) !== 'style:style') continue

      const name = attribute(style, 'style:name')
      if (name === undefined) continue

      const textProperties = findChild(style, 'style:text-properties')
      if (textProperties) {
        const family =
          attribute(textProperties, 'fo:font-family') ??
          fonts.get(attribute(textProperties, 'style:font-name') ?? '')

        text.set(name, {
          bold: attribute(textProperties, 'fo:font-weight') === 'bold',
          italic: attribute(textProperties, 'fo:font-style') === 'italic',
          underline: attribute(textProperties, 'style:text-underline-style') !== undefined,
          strike: attribute(textProperties, 'style:text-line-through-style') !== undefined,
          color: odfColor(attribute(textProperties, 'fo:color')),
          highlight: odfColor(attribute(textProperties, 'fo:background-color')),
          fontFamily: family === undefined ? null : family.replace(/^'|'$/gu, ''),
          // A size given as a percentage is relative to a style we do not
          // resolve, so it is left alone rather than turned into a wrong number.
          fontSize: lengthToPoints(attribute(textProperties, 'fo:font-size')),
        })
      }

      const paragraphProperties = findChild(style, 'style:paragraph-properties')
      if (paragraphProperties) {
        paragraph.set(name, {
          textAlign: alignmentFrom(attribute(paragraphProperties, 'fo:text-align')),
        })
      }
    }
  }

  return { text, paragraph }
}

function marksFor(style: OdtStyle | undefined): { type: string; attrs?: Record<string, unknown> }[] {
  if (!style) return []

  const marks: { type: string; attrs?: Record<string, unknown> }[] = []
  if (style.bold) marks.push({ type: 'bold' })
  if (style.italic) marks.push({ type: 'italic' })
  if (style.underline) marks.push({ type: 'underline' })
  if (style.strike) marks.push({ type: 'strike' })
  if (style.highlight !== null) marks.push({ type: 'highlight', attrs: { color: style.highlight } })

  // Colour, family and size are one mark with three attributes, matching the
  // run properties both document formats keep them in.
  const attrs: Record<string, unknown> = {}
  if (style.color !== null) attrs['color'] = style.color
  if (style.fontFamily !== null) attrs['fontFamily'] = style.fontFamily
  if (style.fontSize !== null) attrs['fontSize'] = style.fontSize
  if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs })

  return marks
}

function inlineFrom(
  node: XmlNode,
  ctx: OdtContext,
  inherited: { type: string; attrs?: Record<string, unknown> }[],
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
        ...marksFor(styleName === undefined ? undefined : ctx.styles.get(styleName)),
      ]
      return children(node).flatMap((child) => inlineFrom(child, ctx, marks))
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
      const inner = children(node).flatMap((child) => inlineFrom(child, ctx, marks))
      if (href !== undefined) {
        for (const item of inner) {
          const link = item.marks?.find((mark) => mark.type === 'link')
          if (link) link.attrs = { href }
        }
      }
      return inner
    }
    case FRAME_TAG: {
      const image = parseFrame(node, ctx)
      if (image !== null) return [image]

      ctx.warnings.push({
        tag: FRAME_TAG,
        message: 'A frame is preserved but cannot be moved or resized yet.',
      })
      return [{ type: 'passthroughInline', attrs: { xml: serializeNode(node), tag: FRAME_TAG } }]
    }
    default:
      if (tag === null) return []
      ctx.warnings.push({ tag, message: `<${tag}> is preserved but not editable.` })
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
    const inline = children(node).flatMap((child) => inlineFrom(child, ctx, []))

    const styleName = attribute(node, 'text:style-name')
    const align =
      styleName === undefined ? null : (ctx.paragraphStyles.get(styleName)?.textAlign ?? null)

    if (tag === HEADING_TAG) {
      const level = Number.parseInt(attribute(node, 'text:outline-level') ?? '1', 10)
      return [
        {
          type: 'heading',
          attrs: {
            level: Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1,
            ...(align === null ? {} : { textAlign: align }),
          },
          ...(inline.length > 0 ? { content: inline } : {}),
        },
      ]
    }

    return [
      {
        type: 'paragraph',
        ...(align === null ? {} : { attrs: { textAlign: align } }),
        ...(inline.length > 0 ? { content: inline } : {}),
      },
    ]
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
  options: {
    listStyles?: Map<string, OdtListStyle>
    resolveImage?: (href: string) => string | null
  } = {},
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

  const named = parseTextStyles(root)
  const ctx: OdtContext = {
    styles: named.text,
    paragraphStyles: named.paragraph,
    listStyles,
    graphicStyles: parseGraphicStyles(root),
    warnings,
    ...(options.resolveImage === undefined ? {} : { resolveImage: options.resolveImage }),
  }
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

/**
 * Styles generated for what the document actually uses.
 *
 * ODT has nowhere to put formatting on the element itself, so every distinct
 * combination of run properties needs a declared style to point at. They are
 * collected while the body is written and emitted together at the end.
 */
interface TextProperties {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string | null
  highlight: string | null
  fontFamily: string | null
  fontSize: number | null
}

function propertiesOf(node: ProseMirrorNodeJson): TextProperties | null {
  const names = markNames(node)
  const textStyle = node.marks?.find((mark) => mark.type === 'textStyle')?.attrs
  const highlight = node.marks?.find((mark) => mark.type === 'highlight')?.attrs?.['color']

  const color = textStyle?.['color']
  const fontFamily = textStyle?.['fontFamily']
  const fontSize = textStyle?.['fontSize']

  const properties: TextProperties = {
    bold: names.has('bold'),
    italic: names.has('italic'),
    underline: names.has('underline'),
    strike: names.has('strike'),
    color: typeof color === 'string' ? color : null,
    highlight: typeof highlight === 'string' ? highlight : null,
    fontFamily: typeof fontFamily === 'string' ? fontFamily : null,
    fontSize: typeof fontSize === 'number' ? fontSize : null,
  }

  const plain =
    !properties.bold &&
    !properties.italic &&
    !properties.underline &&
    !properties.strike &&
    properties.color === null &&
    properties.highlight === null &&
    properties.fontFamily === null &&
    properties.fontSize === null

  return plain ? null : properties
}

interface StyleRegistry {
  /** A style name for these run properties, or null when there are none. */
  forText: (node: ProseMirrorNodeJson) => string | null
  /** A style name for a paragraph that is aligned, or null when it is not. */
  forParagraph: (parent: string, textAlign: unknown) => string | null
  declarations: () => XmlNode[]
}

function createStyles(): StyleRegistry {
  const text = new Map<string, { name: string; properties: TextProperties }>()
  const paragraph = new Map<string, { name: string; parent: string; textAlign: string }>()

  return {
    forText(node) {
      const properties = propertiesOf(node)
      if (properties === null) return null

      const key = JSON.stringify(properties)
      const existing = text.get(key)
      if (existing) return existing.name

      const name = `OD_T${String(text.size + 1)}`
      text.set(key, { name, properties })
      return name
    },

    forParagraph(parent, textAlign) {
      if (typeof textAlign !== 'string' || alignmentFrom(textAlign) === null) return null

      const key = `${parent}|${textAlign}`
      const existing = paragraph.get(key)
      if (existing) return existing.name

      const name = `OD_P${String(paragraph.size + 1)}`
      paragraph.set(key, { name, parent, textAlign })
      return name
    },

    declarations() {
      const nodes: XmlNode[] = []

      for (const { name, properties } of text.values()) {
        const attributes: Record<string, string> = {}
        if (properties.bold) attributes['fo:font-weight'] = 'bold'
        if (properties.italic) attributes['fo:font-style'] = 'italic'
        if (properties.underline) attributes['style:text-underline-style'] = 'solid'
        if (properties.strike) attributes['style:text-line-through-style'] = 'solid'
        if (properties.color !== null) attributes['fo:color'] = properties.color
        if (properties.highlight !== null) {
          attributes['fo:background-color'] = properties.highlight
        }
        // The family is written out rather than named: a `style:font-name`
        // refers to a declaration, and one more part to keep in step is one
        // more way for the reference to go stale.
        if (properties.fontFamily !== null) attributes['fo:font-family'] = properties.fontFamily
        if (properties.fontSize !== null) {
          attributes['fo:font-size'] = `${String(properties.fontSize)}pt`
        }

        nodes.push(
          element('style:style', { 'style:name': name, 'style:family': 'text' }, [
            element('style:text-properties', attributes),
          ]),
        )
      }

      for (const { name, parent, textAlign } of paragraph.values()) {
        nodes.push(
          element(
            'style:style',
            { 'style:name': name, 'style:family': 'paragraph', 'style:parent-style-name': parent },
            [element('style:paragraph-properties', { 'fo:text-align': alignmentTo(textAlign) })],
          ),
        )
      }

      return nodes
    },
  }
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

/**
 * Graphic styles for the wrap modes, named after the mode they carry.
 *
 * ODF names the side the text may occupy, so a picture floated left needs a
 * style that lets text run down its right.
 */
const WRAP_STYLES: Record<string, string> = {
  left: 'OD_WrapLeft',
  right: 'OD_WrapRight',
  topAndBottom: 'OD_WrapNone',
}

function buildGraphicStyle(name: string): XmlNode {
  const wrap = name === 'OD_WrapLeft' ? 'right' : name === 'OD_WrapRight' ? 'left' : 'none'

  return element('style:style', { 'style:name': name, 'style:family': 'graphic' }, [
    element('style:graphic-properties', {
      'style:wrap': wrap,
      'style:horizontal-pos': name === 'OD_WrapRight' ? 'right' : 'left',
      'style:horizontal-rel': 'paragraph',
    }),
  ])
}

/** A picture frame for an image the editor added or resized. */
function buildFrame(node: ProseMirrorNodeJson, index: number, usedGraphics: Set<string>): XmlNode {
  const href = node.attrs?.['href']
  const width = node.attrs?.['width']
  const height = node.attrs?.['height']
  const alt = node.attrs?.['alt']
  const wrapAttr = node.attrs?.['wrap']
  const wrap = typeof wrapAttr === 'string' ? wrapAttr : 'inline'

  const styleName = WRAP_STYLES[wrap]
  if (styleName !== undefined) usedGraphics.add(styleName)

  return element(
    FRAME_TAG,
    {
      'draw:name': `Image${String(index + 1)}`,
      ...(styleName === undefined ? {} : { 'draw:style-name': styleName }),
      // `as-char` is the only anchor that keeps the picture in the text flow;
      // every wrapped one hangs off the paragraph.
      'text:anchor-type': wrap === 'inline' ? 'as-char' : 'paragraph',
      ...(typeof width === 'number' && width > 0 ? { 'svg:width': `${String(width)}pt` } : {}),
      ...(typeof height === 'number' && height > 0 ? { 'svg:height': `${String(height)}pt` } : {}),
    },
    [
      element('draw:image', {
        'xlink:href': typeof href === 'string' ? href : '',
        'xlink:type': 'simple',
        'xlink:show': 'embed',
        'xlink:actuate': 'onLoad',
      }),
      ...(typeof alt === 'string' && alt !== ''
        ? [element('svg:desc', {}, [textNode(alt)])]
        : []),
    ],
  )
}

function serializeInline(
  nodes: readonly ProseMirrorNodeJson[],
  styles: StyleRegistry,
  images: { usedGraphics: Set<string>; count: number },
): XmlNode[] {
  return nodes.flatMap((node): XmlNode[] => {
    if (node.type === 'hardBreak') return [element('text:line-break')]
    if (node.type === 'passthroughInline') {
      const xml = node.attrs?.['xml']
      return typeof xml === 'string' ? parseXml(xml) : []
    }
    if (node.type === 'image') {
      const index = images.count
      images.count += 1

      // An untouched picture is written back exactly as it was read; the frame
      // carries cropping, borders and effects this does not reproduce.
      const original = node.attrs?.['frame']
      const unchanged =
        node.attrs?.['width'] === node.attrs?.['drawingWidth'] &&
        node.attrs?.['wrap'] === node.attrs?.['drawingWrap']

      if (typeof original === 'string' && unchanged) return parseXml(original)

      return [buildFrame(node, index, images.usedGraphics)]
    }
    if (node.type !== 'text') return []

    const styleName = styles.forText(node)
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
  const styles = createStyles()
  const usedLists = new Set<string>()
  const images = { usedGraphics: new Set<string>(), count: 0 }

  const serializeBlock = (node: ProseMirrorNodeJson): XmlNode[] => {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.['level']
        const parent = `Heading_20_${String(typeof level === 'number' ? level : 1)}`
        return [
          element(
            HEADING_TAG,
            {
              'text:style-name': styles.forParagraph(parent, node.attrs?.['textAlign']) ?? parent,
              'text:outline-level': String(typeof level === 'number' ? level : 1),
            },
            serializeInline(node.content ?? [], styles, images),
          ),
        ]
      }
      case 'paragraph':
        return [
          element(
            PARAGRAPH_TAG,
            {
              'text:style-name':
                styles.forParagraph('Standard', node.attrs?.['textAlign']) ?? 'Standard',
            },
            serializeInline(node.content ?? [], styles, images),
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
          'xmlns:draw': 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
          'xmlns:svg': 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
          // A table written with an undeclared prefix is not well-formed XML,
          // so every prefix the serializer can emit is declared here.
          'xmlns:table': 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
          'office:version': '1.3',
        }

  const root = element('office:document-content', attributes, [
    element('office:automatic-styles', {}, [
      ...styles.declarations(),
      ...[...images.usedGraphics].sort().map(buildGraphicStyle),
      ...[...usedLists].sort().map(buildListStyle),
    ]),
    element('office:body', {}, [element('office:text', {}, body)]),
  ])

  return `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml([root])}`
}

/** Data URL for a picture in the package, so the webview can display it. */
export function odtMediaDataUrl(pkg: OdtPackage, href: string): string | null {
  const part = pkg.parts.get(href)
  return part === undefined ? null : dataUrlFrom(part.bytes, href)
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
  const pkg: OdtPackage = { parts }

  const parsed = parseOdtContent(contentXml, {
    ...(stylesXml === undefined ? {} : { listStyles: parseOdtListStyles(stylesXml) }),
    resolveImage: (href) => odtMediaDataUrl(pkg, href),
  })

  return {
    pkg,
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
