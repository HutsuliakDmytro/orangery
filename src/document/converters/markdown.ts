import { safeImageSource } from './image-source'
import { listBuilder } from './list-nesting'
import { flattenTable, parseMarkdownTable, tableFromRows, toMarkdownTable } from './table-text'
import { docOf, markNames, textContentOf } from './types'
import type { ConversionResult, Converter } from './types'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * Markdown.
 *
 * A deliberately small subset — headings, lists, blockquotes, rules, and the
 * inline marks the editor actually has. Markdown has no notion of font, colour
 * or alignment, so those are dropped and reported rather than smuggled through
 * as HTML: a Markdown file with `<span style>` in it is not Markdown.
 */

const HEADING = /^(#{1,6})\s+(.*)$/u
const BULLET = /^\s*[-*+]\s+(.*)$/u
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/u
const QUOTE = /^>\s?(.*)$/u
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/u

interface InlineToken {
  text: string
  marks: string[]
}

/**
 * Parses `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)` and
 * `![alt](src)`.
 *
 * The image alternative is matched at the `!`, which comes one character before
 * the `[` a link would match at — so the leftmost-match rule picks the image
 * without needing to look behind.
 */
export function parseInline(line: string): ProseMirrorNodeJson[] {
  const pattern =
    /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([\s\S]*?\S)\3|(~~)(?=\S)([\s\S]*?\S)\5|`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)\)|!\[([^\]]*)\]\((\S+)\)/gu

  const nodes: ProseMirrorNodeJson[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  const push = (token: InlineToken) => {
    if (token.text === '') return
    nodes.push({
      type: 'text',
      text: token.text,
      ...(token.marks.length > 0 ? { marks: token.marks.map((type) => ({ type })) } : {}),
    })
  }

  while ((match = pattern.exec(line)) !== null) {
    push({ text: line.slice(cursor, match.index), marks: [] })

    if (match[2] !== undefined) push({ text: match[2], marks: ['bold'] })
    else if (match[4] !== undefined) push({ text: match[4], marks: ['italic'] })
    else if (match[6] !== undefined) push({ text: match[6], marks: ['strike'] })
    else if (match[7] !== undefined) push({ text: match[7], marks: ['code'] })
    else if (match[10] !== undefined && match[11] !== undefined) {
      const src = safeImageSource(match[11])
      if (src !== null) nodes.push({ type: 'image', attrs: { src, alt: match[10] } })
    } else if (match[8] !== undefined && match[9] !== undefined) {
      nodes.push({
        type: 'text',
        text: match[8],
        marks: [{ type: 'link', attrs: { href: match[9] } }],
      })
    }

    cursor = match.index + match[0].length
  }

  push({ text: line.slice(cursor), marks: [] })
  return nodes
}

/**
 * How far a line is indented, in columns.
 *
 * A tab advances to the next four-column stop rather than counting as one
 * character, which is how Markdown measures indentation.
 */
function listIndent(line: string): number {
  const leading = /^[ \t]*/u.exec(line)?.[0] ?? ''

  let columns = 0
  for (let index = 0; index < leading.length; index += 1) {
    columns += leading[index] === '\t' ? 4 - (columns % 4) : 1
  }

  return columns
}

export function parseMarkdown(text: string): ConversionResult {
  const lines = text.split(/\r\n|\r|\n/u)
  const content: ProseMirrorNodeJson[] = []

  const lists = listBuilder(content)
  const closeLists = () => {
    lists.close()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    // A run of pipe lines may be a table; `parseMarkdownTable` decides, because
    // a paragraph containing pipes is not one.
    if (line.trim().startsWith('|')) {
      let end = index
      while (end < lines.length && (lines[end] ?? '').trim().startsWith('|')) end += 1

      const rows = parseMarkdownTable(lines.slice(index, end))
      if (rows !== null) {
        closeLists()
        content.push(tableFromRows(rows))
        index = end - 1
        continue
      }
    }

    if (RULE.test(line)) {
      closeLists()
      content.push({ type: 'horizontalRule' })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      closeLists()
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      })
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (bullet?.[1] !== undefined || ordered?.[2] !== undefined) {
      const type = bullet ? 'bulletList' : 'orderedList'

      // The item that opens a numbered list decides where it starts counting.
      const start = Number.parseInt(ordered?.[1] ?? '1', 10)

      lists.addItem(
        type,
        listIndent(line),
        [{ type: 'paragraph', content: parseInline(bullet?.[1] ?? ordered?.[2] ?? '') }],
        Number.isFinite(start) ? start : 1,
      )
      continue
    }

    // A blank line inside a list does not end it; anything else does.
    if (line.trim() === '') continue

    closeLists()

    const quote = QUOTE.exec(line)
    if (quote?.[1] !== undefined) {
      content.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: parseInline(quote[1]) }],
      })
      continue
    }

    content.push({ type: 'paragraph', content: parseInline(line) })
  }

  return { doc: docOf(content), warnings: [] }
}

/** Escapes characters that would otherwise be read as markup. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/gu, '\\$1')
}

function imageMarkup(node: ProseMirrorNodeJson): string {
  const src = node.attrs?.['src']
  if (typeof src !== 'string' || src === '') return ''

  const alt = node.attrs?.['alt']
  return `![${escapeMarkdown(typeof alt === 'string' ? alt : '')}](${src})`
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'image') return imageMarkup(node)
      if (node.type !== 'text') return ''

      const marks = markNames(node)
      let text = escapeMarkdown(node.text ?? '')

      if (marks.has('code')) text = `\`${node.text ?? ''}\``
      if (marks.has('bold')) text = `**${text}**`
      if (marks.has('italic')) text = `*${text}*`
      if (marks.has('strike')) text = `~~${text}~~`

      const link = node.marks?.find((mark) => mark.type === 'link')
      const href = link?.attrs?.['href']
      if (typeof href === 'string') text = `[${text}](${href})`

      return text
    })
    .join('')
}

/**
 * A list as lines of Markdown.
 *
 * A nested list is indented by the width of its parent's marker, which is the
 * least indentation that still counts as content of that item — four spaces
 * past it would be read as a code block instead.
 */
function listLines(list: ProseMirrorNodeJson, indent: string): string[] {
  const lines: string[] = []
  const ordered = list.type === 'orderedList'

  const startAttr = list.attrs?.['start']
  const first = typeof startAttr === 'number' && startAttr > 0 ? startAttr : 1

  ;(list.content ?? []).forEach((item, index) => {
    const marker = ordered ? `${String(first + index)}. ` : '- '
    const inner = ' '.repeat(marker.length)
    const blocks = item.content ?? []

    // An item holding nothing but a nested list still needs a marker of its own,
    // or the nesting has nothing to hang from.
    let started = !blocks.some((child) => child.type !== 'bulletList' && child.type !== 'orderedList')
    if (started) lines.push(`${indent}${marker}`)

    for (const child of blocks) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        lines.push(...listLines(child, indent + inner))
        continue
      }

      const text = serializeInline(child.content ?? [])
      lines.push(started ? `${indent}${inner}${text}` : `${indent}${marker}${text}`)
      started = true
    }
  })

  return lines
}

export function serializeMarkdown(doc: ProseMirrorNodeJson): string {
  const blocks: string[] = []

  const walk = (node: ProseMirrorNodeJson, prefix = ''): void => {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.['level']
        const hashes = '#'.repeat(typeof level === 'number' ? level : 1)
        blocks.push(`${hashes} ${serializeInline(node.content ?? [])}`)
        break
      }
      case 'paragraph':
        blocks.push(`${prefix}${serializeInline(node.content ?? [])}`)
        break
      case 'blockquote':
        for (const child of node.content ?? []) {
          blocks.push(`> ${serializeInline(child.content ?? [])}`)
        }
        break
      case 'bulletList':
      case 'orderedList':
        // One block, not one per item: a blank line between items makes the
        // list loose, and a nested list has to stay attached to its item.
        blocks.push(listLines(node, '').join('\n'))
        break
      case 'table': {
        const flat = flattenTable(node, (block) => serializeInline(block.content ?? []))
        const rendered = toMarkdownTable(flat)
        if (rendered !== '') blocks.push(rendered)
        break
      }
      case 'image': {
        const markup = imageMarkup(node)
        if (markup !== '') blocks.push(`${prefix}${markup}`)
        break
      }
      case 'horizontalRule':
        blocks.push('---')
        break
      case 'pageBreak':
        // Markdown has no page break; a rule is the closest honest equivalent.
        blocks.push('---')
        break
      case 'passthroughBlock':
        break
      default:
        blocks.push(textContentOf(node))
    }
  }

  for (const block of doc.content ?? []) walk(block)

  return blocks.join('\n\n')
}

export const markdownConverter: Converter = {
  parse: parseMarkdown,
  serialize: serializeMarkdown,
}
