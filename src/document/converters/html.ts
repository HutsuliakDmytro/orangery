import { normalizeUrl } from '../../editor/links'
import { cssColor, cssFontFamily, cssLengthToPoints, cssProperties } from './css-values'
import { pixelsToPoints, pointsToPixels, safeImageSource } from './image-source'
import { flattenTable, tableFromRows } from './table-text'
import { docOf, markNames, textContentOf } from './types'
import type { ConversionResult, Converter } from './types'
import type { ParseWarning, ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * HTML import and export.
 *
 * An HTML file is untrusted input: it can carry scripts, event handlers and
 * `javascript:` addresses. Rather than stripping
 * dangerous constructs from a parsed tree — which is a blocklist, and blocklists
 * leak — only known-good elements and attributes are carried over. Everything
 * else contributes its text and nothing more.
 */

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'HR',
  'DIV',
  'PRE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
])

const MARK_FOR_TAG: Readonly<Record<string, string>> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italic',
  I: 'italic',
  U: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  CODE: 'code',
  SUP: 'superscript',
  SUB: 'subscript',
  MARK: 'highlight',
}

/** Elements whose content is never text to display. */
const DROPPED = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'IFRAME'])

const ALIGNMENTS = new Set(['left', 'right', 'center', 'justify'])

/** The alignment an element declares, in CSS or in the older attribute. */
function alignmentOf(element: Element): string | null {
  const declared =
    cssProperties(element.getAttribute('style')).get('text-align') ??
    element.getAttribute('align') ??
    ''

  const value = declared.trim().toLowerCase()
  // `start` and `end` depend on the writing direction; in a left-to-right
  // document they are the sides the editor names.
  const named = value === 'start' ? 'left' : value === 'end' ? 'right' : value

  return ALIGNMENTS.has(named) ? named : null
}

/**
 * The marks an element's inline styles stand for.
 *
 * Read as properties rather than carried through as CSS: what ends up in the
 * document is decided here, the same way the element allowlist decides which
 * elements survive.
 */
function stylesOf(element: Element): { type: string; attrs?: Record<string, unknown> }[] {
  const properties = cssProperties(element.getAttribute('style'))
  if (properties.size === 0) return []

  const marks: { type: string; attrs?: Record<string, unknown> }[] = []

  const weight = properties.get('font-weight')
  if (weight === 'bold' || weight === 'bolder' || Number.parseInt(weight ?? '', 10) >= 600) {
    marks.push({ type: 'bold' })
  }

  const style = properties.get('font-style')
  if (style === 'italic' || style === 'oblique') marks.push({ type: 'italic' })

  const decoration = properties.get('text-decoration') ?? properties.get('text-decoration-line')
  if (decoration?.includes('underline')) marks.push({ type: 'underline' })
  if (decoration?.includes('line-through')) marks.push({ type: 'strike' })

  const highlight = cssColor(properties.get('background-color') ?? properties.get('background'))
  if (highlight !== null) marks.push({ type: 'highlight', attrs: { color: highlight } })

  // Colour, family and size are one mark with three attributes, matching the
  // run properties the document formats keep them in.
  const attrs: Record<string, unknown> = {}

  const color = cssColor(properties.get('color'))
  if (color !== null) attrs['color'] = color

  const family = cssFontFamily(properties.get('font-family'))
  if (family !== null) attrs['fontFamily'] = family

  const size = cssLengthToPoints(properties.get('font-size'))
  if (size !== null) attrs['fontSize'] = size

  if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs })

  return marks
}

function inlineFrom(
  node: Node,
  marks: { type: string; attrs?: Record<string, unknown> }[],
  warnings: ParseWarning[],
): ProseMirrorNodeJson[] {
  if (node.nodeType === node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (text === '') return []
    return [{ type: 'text', text, ...(marks.length > 0 ? { marks: [...marks] } : {}) }]
  }

  if (node.nodeType !== node.ELEMENT_NODE) return []
  const element = node as Element
  const tag = element.tagName.toUpperCase()

  if (DROPPED.has(tag)) return []

  if (tag === 'BR') return [{ type: 'hardBreak' }]

  if (tag === 'IMG') {
    const src = element.getAttribute('src')
    const safe = src === null ? null : safeImageSource(src)

    if (safe === null) {
      warnings.push({
        tag: 'img',
        message:
          src === null
            ? 'An image was removed because it has no address.'
            : `An image was removed because its address is not a supported kind (${src.slice(0, 40)}).`,
      })
      return []
    }

    const width = pixelsToPoints(element.getAttribute('width'))
    const height = pixelsToPoints(element.getAttribute('height'))

    return [
      {
        type: 'image',
        attrs: {
          src: safe,
          alt: element.getAttribute('alt') ?? '',
          ...(width === null ? {} : { width }),
          ...(height === null ? {} : { height }),
        },
      },
    ]
  }

  const nextMarks = [...marks]
  const markType = MARK_FOR_TAG[tag]
  if (markType !== undefined) nextMarks.push({ type: markType })
  nextMarks.push(...stylesOf(element))

  if (tag === 'A') {
    const href = element.getAttribute('href')
    const safe = href === null ? null : normalizeUrl(href)
    if (href !== null && safe === null) {
      warnings.push({
        tag: 'a',
        message: `A link was removed because its address is not a supported kind (${href.slice(0, 40)}).`,
      })
    }
    if (safe !== null) nextMarks.push({ type: 'link', attrs: { href: safe } })
  }

  return [...element.childNodes].flatMap((child) => inlineFrom(child, nextMarks, warnings))
}

function blocksFrom(node: Node, warnings: ParseWarning[]): ProseMirrorNodeJson[] {
  if (node.nodeType !== node.ELEMENT_NODE) {
    // Whitespace between block elements is formatting of the HTML, not content.
    // Without this, any pretty-printed document gains an empty paragraph
    // between every pair of elements.
    if ((node.textContent ?? '').trim() === '') return []

    const inline = inlineFrom(node, [], warnings)
    return inline.length > 0 ? [{ type: 'paragraph', content: inline }] : []
  }

  const element = node as Element
  const tag = element.tagName.toUpperCase()

  if (DROPPED.has(tag)) return []

  if (tag === 'HR') return [{ type: 'horizontalRule' }]

  // An image has no children, so the walk below would find nothing inside it
  // and drop it. It is the element itself that carries the content.
  if (tag === 'IMG') {
    const image = inlineFrom(element, [], warnings)
    return image.length > 0 ? [{ type: 'paragraph', content: image }] : []
  }

  if (/^H[1-6]$/u.test(tag)) {
    const align = alignmentOf(element)
    return [
      {
        type: 'heading',
        attrs: {
          level: Number.parseInt(tag.slice(1), 10),
          ...(align === null ? {} : { textAlign: align }),
        },
        content: [...element.childNodes].flatMap((child) => inlineFrom(child, [], warnings)),
      },
    ]
  }

  if (tag === 'UL' || tag === 'OL') {
    const items = [...element.children]
      .filter((child) => child.tagName.toUpperCase() === 'LI')
      .map((item) => ({
        type: 'listItem',
        content: blocksFrom(item, warnings),
      }))
    return items.length > 0
      ? [{ type: tag === 'UL' ? 'bulletList' : 'orderedList', content: items }]
      : []
  }

  if (tag === 'TABLE') {
    const rows = [...element.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('td, th')].map((cell) => cell.textContent.trim()),
    )
    return rows.length > 0 ? [tableFromRows(rows)] : []
  }

  if (tag === 'BLOCKQUOTE') {
    return [
      {
        type: 'blockquote',
        content: [...element.childNodes].flatMap((child) => blocksFrom(child, warnings)),
      },
    ]
  }

  // A container that holds blocks is unwrapped; one that holds only inline
  // content becomes a paragraph.
  const hasBlockChildren = [...element.children].some((child) =>
    BLOCK_TAGS.has(child.tagName.toUpperCase()),
  )

  if (hasBlockChildren) {
    return [...element.childNodes].flatMap((child) => blocksFrom(child, warnings))
  }

  const inline = [...element.childNodes].flatMap((child) => inlineFrom(child, [], warnings))
  if (inline.length === 0) return []

  const align = alignmentOf(element)
  return [{ type: 'paragraph', ...(align === null ? {} : { attrs: { textAlign: align } }), content: inline }]
}

export function parseHtml(html: string): ConversionResult {
  const warnings: ParseWarning[] = []

  // DOMParser does not execute scripts or load subresources, so parsing pasted
  // markup is safe; what makes it into the document is decided above.
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const content = [...parsed.body.childNodes].flatMap((node) => blocksFrom(node, warnings))

  return { doc: docOf(content), warnings }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

function imageTag(node: ProseMirrorNodeJson): string {
  const src = node.attrs?.['src']
  if (typeof src !== 'string' || src === '') return ''

  const alt = node.attrs?.['alt']
  const width = node.attrs?.['width']

  return [
    `<img src="${escapeHtml(src)}"`,
    ` alt="${escapeHtml(typeof alt === 'string' ? alt : '')}"`,
    // The editor sizes in points, which is what the document formats use; HTML
    // has no unit on the attribute, so it is pixels.
    typeof width === 'number' && width > 0 ? ` width="${String(pointsToPixels(width))}"` : '',
    '>',
  ].join('')
}

/** The inline styles a run's marks stand for, as one `style` attribute. */
function styleAttribute(node: ProseMirrorNodeJson): string {
  const textStyle = node.marks?.find((mark) => mark.type === 'textStyle')?.attrs
  const highlight = node.marks?.find((mark) => mark.type === 'highlight')?.attrs?.['color']

  const color = textStyle?.['color']
  const family = textStyle?.['fontFamily']
  const size = textStyle?.['fontSize']

  const declarations = [
    typeof color === 'string' ? `color: ${color}` : '',
    typeof family === 'string' ? `font-family: ${family}` : '',
    // The editor sizes in points, which CSS states directly.
    typeof size === 'number' ? `font-size: ${String(size)}pt` : '',
    typeof highlight === 'string' ? `background-color: ${highlight}` : '',
  ].filter((declaration) => declaration !== '')

  return declarations.join('; ')
}

/** The `style` attribute for an aligned block, or nothing when it is not. */
function alignAttribute(node: ProseMirrorNodeJson): string {
  const align = node.attrs?.['textAlign']
  if (typeof align !== 'string' || !ALIGNMENTS.has(align)) return ''
  return ` style="text-align: ${align}"`
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '<br>'
      if (node.type === 'image') return imageTag(node)
      if (node.type !== 'text') return ''

      const marks = markNames(node)
      let html = escapeHtml(node.text ?? '')

      if (marks.has('code')) html = `<code>${html}</code>`
      if (marks.has('bold')) html = `<strong>${html}</strong>`
      if (marks.has('italic')) html = `<em>${html}</em>`
      if (marks.has('underline')) html = `<u>${html}</u>`
      if (marks.has('strike')) html = `<s>${html}</s>`
      if (marks.has('superscript')) html = `<sup>${html}</sup>`
      if (marks.has('subscript')) html = `<sub>${html}</sub>`

      // A highlight with no colour of its own still marks the text, which is
      // what `<mark>` means; one with a colour is carried in the style instead.
      if (marks.has('highlight') && styleAttribute(node) === '') html = `<mark>${html}</mark>`

      const style = styleAttribute(node)
      if (style !== '') html = `<span style="${escapeHtml(style)}">${html}</span>`

      const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.['href']
      if (typeof href === 'string') {
        html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${html}</a>`
      }

      return html
    })
    .join('')
}

function serializeBlock(node: ProseMirrorNodeJson): string {
  switch (node.type) {
    case 'heading': {
      const level = node.attrs?.['level']
      const tag = `h${String(typeof level === 'number' ? level : 1)}`
      return `<${tag}${alignAttribute(node)}>${serializeInline(node.content ?? [])}</${tag}>`
    }
    case 'paragraph':
      return `<p${alignAttribute(node)}>${serializeInline(node.content ?? [])}</p>`
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map(serializeBlock).join('')}</blockquote>`
    case 'bulletList':
    case 'orderedList': {
      const tag = node.type === 'bulletList' ? 'ul' : 'ol'
      const items = (node.content ?? [])
        .map((item) => `<li>${(item.content ?? []).map(serializeBlock).join('')}</li>`)
        .join('')
      return `<${tag}>${items}</${tag}>`
    }
    case 'table': {
      const flat = flattenTable(node, (block) => serializeInline(block.content ?? []))
      const rows = flat.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
        .join('')
      return rows === '' ? '' : `<table><tbody>${rows}</tbody></table>`
    }
    case 'image':
      return imageTag(node)
    case 'horizontalRule':
    case 'pageBreak':
      return '<hr>'
    case 'passthroughBlock':
      return ''
    default:
      return `<p>${escapeHtml(textContentOf(node))}</p>`
  }
}

export function serializeHtml(doc: ProseMirrorNodeJson): string {
  const body = (doc.content ?? []).map(serializeBlock).join('\n')
  return `<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n${body}\n</body>\n</html>`
}

export const htmlConverter: Converter = { parse: parseHtml, serialize: serializeHtml }
