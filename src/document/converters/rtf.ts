import { listBuilder } from './list-nesting'
import type { ListKind } from './list-nesting'
import { flattenTable } from './table-text'
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

/**
 * The literal marker a writer puts in front of a list item, for readers that
 * cannot render list formatting.
 *
 * It must not land in the paragraph's text, but it is worth reading: RTF keeps
 * the kind of list in a numbering table referenced by id, and the marker says
 * the same thing in a form that does not need the table.
 */
const MARKER_DESTINATIONS = new Set(['listtext', 'pntext'])

/** Twips of indent per list level, and the hanging indent of the marker. */
const LIST_INDENT = 720
const MARKER_INDENT = -360

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

/**
 * Whether a marker numbers its item or just points at it.
 *
 * A digit is the clear case; a letter followed by a separator covers the
 * alphabetic and roman numbering Word also writes. Every bullet character sits
 * outside both, so anything else is a bullet.
 */
function kindOf(marker: string): ListKind {
  if (/\d/u.test(marker)) return 'orderedList'
  return /^\s*[a-z]+[.)]/iu.test(marker) ? 'orderedList' : 'bulletList'
}

/** The number a list counts from, when its first marker says one. */
function startOf(marker: string): number {
  const digits = /\d+/u.exec(marker)
  if (digits === null) return 1

  const value = Number.parseInt(digits[0], 10)
  return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * How deeply an item is nested.
 *
 * `\ilvl` says so outright. A writer that uses the older per-paragraph form
 * does not emit it, and there the left indent is the only depth there is.
 */
function levelOf(declared: number | null, indent: number | null): number {
  if (declared !== null) return declared
  if (indent === null) return 0
  return Math.max(0, Math.round(indent / LIST_INDENT) - 1)
}

export function parseRtf(text: string): ConversionResult {
  const warnings: ParseWarning[] = []
  const content: ProseMirrorNodeJson[] = []

  let current: ProseMirrorNodeJson[] = []
  let headingLevel: number | null = null
  // Rows collected since `\trowd`, and the cells of the row being read.
  let rows: ProseMirrorNodeJson[] | null = null
  let cells: ProseMirrorNodeJson[] | null = null

  const lists = listBuilder(content)

  // Set while reading a marker group, so its text goes to the marker and not to
  // the paragraph. Null means the paragraph has no marker and is not an item.
  let markerDepth: number | null = null
  let marker: string | null = null
  // List level and indent, as the paragraph declared them.
  let itemLevel: number | null = null
  let itemIndent: number | null = null
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

  const emit = (value: string) => {
    if (markerDepth !== null) marker = (marker ?? '') + value
    else if (skipDepth === null) pendingText += value
  }

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

  /** A table ends at the first paragraph that is not part of a row. */
  const closeTable = () => {
    if (rows === null) return
    if (rows.length > 0) content.push({ type: 'table', content: rows })
    rows = null
  }

  const endParagraph = () => {
    flushText()

    // Inside a cell, `\par` separates paragraphs of that cell; the cell is
    // closed by `\cell`, not here.
    if (cells !== null) return

    closeTable()

    const paragraph: ProseMirrorNodeJson = {
      type: 'paragraph',
      ...(current.length > 0 ? { content: current } : {}),
    }

    if (marker !== null && headingLevel === null) {
      lists.addItem(kindOf(marker), levelOf(itemLevel, itemIndent), [paragraph], startOf(marker))
    } else {
      lists.close()

      if (headingLevel !== null) {
        content.push({
          type: 'heading',
          attrs: { level: headingLevel },
          ...(current.length > 0 ? { content: current } : {}),
        })
      } else {
        content.push(paragraph)
      }
    }

    current = []
    headingLevel = null
    marker = null
    itemLevel = null
    itemIndent = null
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
      if (markerDepth !== null && depth <= markerDepth) markerDepth = null
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
        emit(next)
        index += 2
        continue
      }

      // A hex-escaped byte; without the code page we cannot decode it reliably,
      // so it is reported rather than turned into a wrong character.
      if (next === "'") {
        const hex = text.slice(index + 2, index + 4)
        const code = Number.parseInt(hex, 16)
        if (Number.isFinite(code)) emit(String.fromCharCode(code))
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
        emit(String.fromCharCode(codeUnit))
        // The fallback characters that follow are for readers that cannot do
        // Unicode; appending them would duplicate the character as `?`.
        skipCharacters = unicodeSkip
        continue
      }

      if (MARKER_DESTINATIONS.has(word)) {
        markerDepth = depth
        marker = ''
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
        case 'trowd':
          // A new row. The first one also ends whatever paragraph preceded it.
          if (rows === null) {
            if (current.length > 0) endParagraph()
            rows = []
          }
          cells = []
          break
        case 'cell':
          flushText()
          cells?.push({
            type: 'tableCell',
            // A cell has to hold at least one block, as it does in OOXML.
            content: [{ type: 'paragraph', ...(current.length > 0 ? { content: current } : {}) }],
          })
          current = []
          break
        case 'row':
          flushText()
          if (cells !== null && rows !== null) rows.push({ type: 'tableRow', content: cells })
          cells = null
          break
        case 'pard':
          flushText()
          state = { ...CLEAN_STATE }
          headingLevel = null
          marker = null
          itemLevel = null
          itemIndent = null
          break
        case 'ilvl':
          if (parameter !== null && parameter >= 0) itemLevel = parameter
          break
        case 'li':
          if (parameter !== null && parameter >= 0) itemIndent = parameter
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
          emit('\t')
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

    if (char !== undefined) emit(char)
    index += 1
  }

  flushText()
  if (cells !== null && rows !== null) {
    rows.push({ type: 'tableRow', content: cells })
    cells = null
  }
  if (current.length > 0 || marker !== null) endParagraph()
  lists.close()
  closeTable()

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

/**
 * The width of the text column, in twips.
 *
 * RTF places cell edges at absolute positions, so a table needs a page width to
 * divide up. There is no section in a flat format, so this is the page a new
 * document starts on: Letter with one inch margins.
 */
const COLUMN_WIDTH = 9360

/**
 * A list as RTF paragraphs.
 *
 * RTF has two ways to write a list: a numbering table referenced by id, and the
 * older per-paragraph form used here. The latter repeats the marker on every
 * paragraph, which is more verbose but understood by every reader — including
 * the ones that ignore the numbering table entirely and would otherwise show
 * the list as unindented body text.
 */
function listParagraphs(list: ProseMirrorNodeJson, level: number): string[] {
  const lines: string[] = []
  const ordered = list.type === 'orderedList'

  const startAttr = list.attrs?.['start']
  const first = typeof startAttr === 'number' && startAttr > 0 ? startAttr : 1

  ;(list.content ?? []).forEach((item, index) => {
    // `\'b7` is the bullet in the ANSI code page this file declares.
    const marker = ordered
      ? `{\\pntext\\f0 ${String(first + index)}.\\tab}{\\*\\pn\\pnlvlbody\\pnf0\\pnindent0\\pnstart${String(first + index)}\\pndec{\\pntxta.}}`
      : `{\\pntext\\f0 \\'b7\\tab}{\\*\\pn\\pnlvlblt\\pnf0\\pnindent0{\\pntxtb\\'b7}}`

    const indent = `\\fi${String(MARKER_INDENT)}\\li${String(LIST_INDENT * level)}`

    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        lines.push(...listParagraphs(child, level + 1))
        continue
      }

      // No space before the text: after a closing brace a space is literal, and
      // the marker group already separates it from the indent control words.
      lines.push(`\\pard${indent}${marker}${serializeInline(child.content ?? [])}\\par`)
    }
  })

  return lines
}

/** A table as RTF rows. Cells are laid out evenly across the text column. */
function tableRows(node: ProseMirrorNodeJson): string {
  const flat = flattenTable(node, (block) => serializeInline(block.content ?? []))
  // `flattenTable` pads ragged rows, so every row is as wide as the widest.
  const columns = flat.rows[0]?.length ?? 0
  if (columns === 0) return ''

  const edges = Array.from({ length: columns }, (_unused, index) =>
    Math.round((COLUMN_WIDTH / columns) * (index + 1)),
  )
  const layout = `\\trowd\\trgaph108${edges.map((edge) => `\\cellx${String(edge)}`).join('')}`

  return flat.rows
    .map((row) => {
      const body = row.map((cell) => `\\intbl ${cell}\\cell`).join('')
      return `${layout}\n${body}\\row`
    })
    .join('\n')
}

export function serializeRtf(doc: ProseMirrorNodeJson): string {
  const blocks: string[] = []

  for (const block of doc.content ?? []) {
    switch (block.type) {
      case 'bulletList':
      case 'orderedList':
        blocks.push(listParagraphs(block, 1).join('\n'))
        break
      case 'table': {
        const rendered = tableRows(block)
        if (rendered !== '') blocks.push(rendered)
        break
      }
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
