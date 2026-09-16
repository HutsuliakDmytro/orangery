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
const ORDERED = /^\s*\d+[.)]\s+(.*)$/u
const QUOTE = /^>\s?(.*)$/u
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/u

interface InlineToken {
  text: string
  marks: string[]
}

/** Parses `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and `[text](url)`. */
export function parseInline(line: string): ProseMirrorNodeJson[] {
  const pattern =
    /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([\s\S]*?\S)\3|(~~)(?=\S)([\s\S]*?\S)\5|`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)\)/gu

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
    else if (match[8] !== undefined && match[9] !== undefined) {
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

export function parseMarkdown(text: string): ConversionResult {
  const lines = text.split(/\r\n|\r|\n/u)
  const content: ProseMirrorNodeJson[] = []

  let listItems: ProseMirrorNodeJson[] = []
  let listType: 'bulletList' | 'orderedList' | null = null

  const flushList = () => {
    if (listType === null || listItems.length === 0) {
      listItems = []
      listType = null
      return
    }
    content.push({ type: listType, content: listItems })
    listItems = []
    listType = null
  }

  for (const line of lines) {
    if (RULE.test(line)) {
      flushList()
      content.push({ type: 'horizontalRule' })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flushList()
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      })
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (bullet?.[1] !== undefined || ordered?.[1] !== undefined) {
      const wanted = bullet ? 'bulletList' : 'orderedList'
      if (listType !== wanted) flushList()
      listType = wanted
      listItems.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInline(bullet?.[1] ?? ordered?.[1] ?? '') }],
      })
      continue
    }

    flushList()

    const quote = QUOTE.exec(line)
    if (quote?.[1] !== undefined) {
      content.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: parseInline(quote[1]) }],
      })
      continue
    }

    if (line.trim() === '') {
      continue
    }

    content.push({ type: 'paragraph', content: parseInline(line) })
  }

  flushList()

  return { doc: docOf(content), warnings: [] }
}

/** Escapes characters that would otherwise be read as markup. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/gu, '\\$1')
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[]): string {
  return nodes
    .map((node) => {
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
      case 'orderedList': {
        const ordered = node.type === 'orderedList'
        ;(node.content ?? []).forEach((item, index) => {
          const marker = ordered ? `${String(index + 1)}. ` : '- '
          const text = (item.content ?? [])
            .map((child) => serializeInline(child.content ?? []))
            .join(' ')
          blocks.push(`${marker}${text}`)
        })
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
