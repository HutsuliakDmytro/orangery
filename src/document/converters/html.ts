import { normalizeUrl } from '../../editor/links'
import { flattenTable, tableFromRows } from './table-text'
import { docOf, markNames, textContentOf } from './types'
import type { ConversionResult, Converter } from './types'
import type { ParseWarning, ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * HTML import and export.
 *
 * Import is also the clipboard path, so the input is untrusted: pasted HTML can
 * carry scripts, event handlers and `javascript:` links. Rather than stripping
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

  const nextMarks = [...marks]
  const markType = MARK_FOR_TAG[tag]
  if (markType !== undefined) nextMarks.push({ type: markType })

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

  if (/^H[1-6]$/u.test(tag)) {
    return [
      {
        type: 'heading',
        attrs: { level: Number.parseInt(tag.slice(1), 10) },
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
  return inline.length > 0 ? [{ type: 'paragraph', content: inline }] : []
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

function serializeInline(nodes: readonly ProseMirrorNodeJson[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '<br>'
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
      return `<${tag}>${serializeInline(node.content ?? [])}</${tag}>`
    }
    case 'paragraph':
      return `<p>${serializeInline(node.content ?? [])}</p>`
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
