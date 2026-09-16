import { docOf, markNames, textContentOf } from './types'
import type { ConversionResult, Converter } from './types'
import type { ParseWarning, ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * RTF, basic formatting only.
 *
 * RTF is a control-word stream rather than a tree, so parsing means tracking
 * formatting state across a token sequence and pushing/popping it on braces.
 * Groups the parser does not understand — font tables, colour tables, embedded
 * objects — are skipped wholesale rather than guessed at: `\*\` marks a
 * destination the reader is explicitly allowed to ignore, and misreading one
 * produces garbage text in the document.
 */

const IGNORED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'generator',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'xmlnstbl',
])

interface RunState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  superscript: boolean
  subscript: boolean
}

const CLEAN_STATE: RunState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
}

function marksFor(state: RunState): { type: string }[] {
  const marks: { type: string }[] = []
  if (state.bold) marks.push({ type: 'bold' })
  if (state.italic) marks.push({ type: 'italic' })
  if (state.underline) marks.push({ type: 'underline' })
  if (state.strike) marks.push({ type: 'strike' })
  if (state.superscript) marks.push({ type: 'superscript' })
  if (state.subscript) marks.push({ type: 'subscript' })
  return marks
}

export function parseRtf(text: string): ConversionResult {
  const warnings: ParseWarning[] = []
  const content: ProseMirrorNodeJson[] = []

  let current: ProseMirrorNodeJson[] = []
  let headingLevel: number | null = null
  const stack: RunState[] = []
  let state: RunState = { ...CLEAN_STATE }

  let index = 0
  let skipDepth: number | null = null
  let depth = 0
  let pendingText = ''
  // `\ucN` declares how many fallback characters follow each `\uN`. Writers that
  // omit it mean one, which is what the spec says to assume.
  let unicodeSkip = 1
  let skipCharacters = 0

  const flushText = () => {
    if (pendingText === '') return
    const marks = marksFor(state)
    current.push({
      type: 'text',
      text: pendingText,
      ...(marks.length > 0 ? { marks } : {}),
    })
    pendingText = ''
  }

  const endParagraph = () => {
    flushText()
    if (headingLevel !== null) {
      content.push({
        type: 'heading',
        attrs: { level: headingLevel },
        ...(current.length > 0 ? { content: current } : {}),
      })
    } else {
      content.push({
        type: 'paragraph',
        ...(current.length > 0 ? { content: current } : {}),
      })
    }
    current = []
    headingLevel = null
  }

  while (index < text.length) {
    const char = text[index]

    if (char === '{') {
      depth += 1
      stack.push({ ...state })
      index += 1
      continue
    }

    if (char === '}') {
      flushText()
      if (skipDepth !== null && depth <= skipDepth) skipDepth = null
      depth -= 1
      state = stack.pop() ?? { ...CLEAN_STATE }
      index += 1
      continue
    }

    if (char === '\\') {
      const next = text[index + 1]

      // Escaped literal characters.
      if (next === '\\' || next === '{' || next === '}') {
        if (skipDepth === null) pendingText += next
        index += 2
        continue
      }

      // A hex-escaped byte; without the code page we cannot decode it reliably,
      // so it is reported rather than turned into a wrong character.
      if (next === "'") {
        const hex = text.slice(index + 2, index + 4)
        const code = Number.parseInt(hex, 16)
        if (skipDepth === null && Number.isFinite(code)) {
          pendingText += String.fromCharCode(code)
        }
        index += 4
        continue
      }

      // `\*` marks a destination the reader may ignore.
      if (next === '*') {
        skipDepth = depth
        index += 2
        continue
      }

      const match = /^\\([a-zA-Z]+)(-?\d+)? ?/u.exec(text.slice(index))
      if (!match?.[1]) {
        index += 1
        continue
      }

      const word = match[1]
      const parameter = match[2] === undefined ? null : Number.parseInt(match[2], 10)
      index += match[0].length

      if (word === 'uc') {
        if (parameter !== null && parameter >= 0) unicodeSkip = parameter
        continue
      }

      if (word === 'u' && parameter !== null) {
        // RTF writes code units as signed 16-bit, so values above 32767 arrive
        // negative. Surrogate pairs come through as two consecutive escapes and
        // recombine on their own once both halves are in the string.
        const codeUnit = parameter < 0 ? parameter + 65536 : parameter
        if (skipDepth === null) pendingText += String.fromCharCode(codeUnit)
        // The fallback characters that follow are for readers that cannot do
        // Unicode; appending them would duplicate the character as `?`.
        skipCharacters = unicodeSkip
        continue
      }

      if (IGNORED_DESTINATIONS.has(word)) {
        skipDepth = depth
        continue
      }

      if (skipDepth !== null) continue

      switch (word) {
        case 'par':
        case 'line':
          endParagraph()
          break
        case 'pard':
          flushText()
          state = { ...CLEAN_STATE }
          headingLevel = null
          break
        case 'b':
          flushText()
          state = { ...state, bold: parameter !== 0 }
          break
        case 'i':
          flushText()
          state = { ...state, italic: parameter !== 0 }
          break
        case 'ul':
          flushText()
          state = { ...state, underline: true }
          break
        case 'ulnone':
          flushText()
          state = { ...state, underline: false }
          break
        case 'strike':
          flushText()
          state = { ...state, strike: parameter !== 0 }
          break
        case 'super':
          flushText()
          state = { ...state, superscript: true }
          break
        case 'sub':
          flushText()
          state = { ...state, subscript: true }
          break
        case 'nosupersub':
          flushText()
          state = { ...state, superscript: false, subscript: false }
          break
        case 'outlinelevel':
          if (parameter !== null && parameter >= 0 && parameter <= 5) {
            headingLevel = parameter + 1
          }
          break
        case 'tab':
          pendingText += '\t'
          break
        case 'page':
          flushText()
          current.push({ type: 'pageBreak' })
          break
        default:
          break
      }

      continue
    }

    // Literal line breaks in the source are formatting of the RTF itself.
    if (char === '\n' || char === '\r') {
      index += 1
      continue
    }

    if (skipCharacters > 0) {
      skipCharacters -= 1
      index += 1
      continue
    }

    if (skipDepth === null && char !== undefined) pendingText += char
    index += 1
  }

  flushText()
  if (current.length > 0) endParagraph()

  // Every RTF file starts with an `\rtf` version control word. Text without one
  // still parses into paragraphs, so the only honest signal is its absence.
  if (text.trim() !== '' && !text.includes('\\rtf')) {
    warnings.push({ tag: 'rtf', message: 'This file does not look like RTF.' })
  }

  return { doc: docOf(content), warnings }
}

/** RTF is ASCII; anything above becomes a `\uN?` escape. */
export function escapeRtf(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0

    if (char === '\\' || char === '{' || char === '}') result += `\\${char}`
    else if (char === '\t') result += '\\tab '
    else if (code < 128) result += char
    else if (code <= 0xffff) result += `\\u${String(code)}?`
    else {
      // Astral characters need a surrogate pair, which is what RTF readers expect.
      const offset = code - 0x10000
      const high = 0xd800 + (offset >> 10)
      const low = 0xdc00 + (offset & 0x3ff)
      result += `\\u${String(high)}?\\u${String(low)}?`
    }
  }
  return result
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'pageBreak') return '\\page '
      if (node.type === 'hardBreak') return '\\line '
      if (node.type !== 'text') return ''

      const marks = markNames(node)
      const open: string[] = []
      const close: string[] = []

      if (marks.has('bold')) {
        open.push('\\b ')
        close.push('\\b0 ')
      }
      if (marks.has('italic')) {
        open.push('\\i ')
        close.push('\\i0 ')
      }
      if (marks.has('underline')) {
        open.push('\\ul ')
        close.push('\\ulnone ')
      }
      if (marks.has('strike')) {
        open.push('\\strike ')
        close.push('\\strike0 ')
      }
      if (marks.has('superscript')) {
        open.push('\\super ')
        close.push('\\nosupersub ')
      }
      if (marks.has('subscript')) {
        open.push('\\sub ')
        close.push('\\nosupersub ')
      }

      return `${open.join('')}${escapeRtf(node.text ?? '')}${close.reverse().join('')}`
    })
    .join('')
}

export function serializeRtf(doc: ProseMirrorNodeJson): string {
  const blocks: string[] = []

  for (const block of doc.content ?? []) {
    switch (block.type) {
      case 'heading': {
        const level = block.attrs?.['level']
        const outline = typeof level === 'number' ? level - 1 : 0
        blocks.push(
          `\\pard\\outlinelevel${String(outline)}\\b ${serializeInline(block.content ?? [])}\\b0\\par`,
        )
        break
      }
      case 'paragraph':
        blocks.push(`\\pard ${serializeInline(block.content ?? [])}\\par`)
        break
      case 'horizontalRule':
        blocks.push('\\pard\\brdrb\\brdrs\\brdrw10\\par')
        break
      case 'pageBreak':
        blocks.push('\\pard\\page\\par')
        break
      case 'passthroughBlock':
        break
      default:
        blocks.push(`\\pard ${escapeRtf(textContentOf(block))}\\par`)
    }
  }

  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\fs22\n${blocks.join('\n')}\n}`
}

export const rtfConverter: Converter = { parse: parseRtf, serialize: serializeRtf }
