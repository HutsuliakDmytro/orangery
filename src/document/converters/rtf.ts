import { dataUrlFrom, decodeDataUrl } from '../data-url'
import { listBuilder } from '../../ooxml/list-nesting'
import { attributesFor, hasProperties, propertiesOf } from './paragraph-properties'
import type { ParagraphProperties } from './paragraph-properties'
import type { ListKind } from '../../ooxml/list-nesting'
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
  'stylesheet',
  'info',
  'object',
  // The metafile copy of a picture, written beside the real one for readers
  // that cannot decode PNG or JPEG. Reading both would duplicate the picture.
  'nonshppict',
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

/**
 * Picture encodings RTF names, and the image type each one holds.
 *
 * Only the two that a webview can display directly are read. A metafile or a
 * device-dependent bitmap would have to be rasterised first, which is a decoder
 * this app does not carry.
 */
const PICTURE_TYPES: Readonly<Record<string, string>> = {
  pngblip: 'png',
  jpegblip: 'jpg',
}

/** Twips per point, the unit RTF states a picture's display size in. */
const TWIPS_PER_POINT = 20

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
  color: string | null
  highlight: string | null
  fontFamily: string | null
  /** In points; RTF states it in half-points. */
  fontSize: number | null
}

const CLEAN_STATE: RunState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  color: null,
  highlight: null,
  fontFamily: null,
  fontSize: null,
}

/** RTF states a font size in half-points, as OOXML does. */
const HALF_POINTS_PER_POINT = 2

/** RTF measures indents and spacing in twips, twenty to the point. */
const TWIPS = 20

/** A line height is stated in 240ths of a line, as `w:line` is in OOXML. */
const LINE_UNITS = 240

/** Alignment control words, named after the edge the text is pushed to. */
const ALIGNMENTS: Readonly<Record<string, string>> = {
  ql: 'left',
  qr: 'right',
  qc: 'center',
  qj: 'justify',
}

function marksFor(state: RunState): { type: string; attrs?: Record<string, unknown> }[] {
  const marks: { type: string; attrs?: Record<string, unknown> }[] = []
  if (state.bold) marks.push({ type: 'bold' })
  if (state.italic) marks.push({ type: 'italic' })
  if (state.underline) marks.push({ type: 'underline' })
  if (state.strike) marks.push({ type: 'strike' })
  if (state.superscript) marks.push({ type: 'superscript' })
  if (state.subscript) marks.push({ type: 'subscript' })
  if (state.highlight !== null) marks.push({ type: 'highlight', attrs: { color: state.highlight } })

  // Colour, family and size are one mark with three attributes, matching the
  // run properties the document formats keep them in.
  const attrs: Record<string, unknown> = {}
  if (state.color !== null) attrs['color'] = state.color
  if (state.fontFamily !== null) attrs['fontFamily'] = state.fontFamily
  if (state.fontSize !== null) attrs['fontSize'] = state.fontSize
  if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs })

  return marks
}

function rgbToHex(channels: { red: number; green: number; blue: number }): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase()

  return `#${part(channels.red)}${part(channels.green)}${part(channels.blue)}`
}

/** A picture's bytes, written as hex, as something the webview can display. */
function dataUrlFromHex(hex: string, extension: string): string {
  const even = hex.length % 2 === 0 ? hex : hex.slice(0, -1)

  let binary = ''
  for (let index = 0; index < even.length; index += 2) {
    binary += String.fromCharCode(Number.parseInt(even.slice(index, index + 2), 16))
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  return dataUrlFrom(bytes, `picture.${extension}`) ?? ''
}

/** A picture as a `\pict` group, with its bytes written back out as hex. */
function pictureGroup(node: ProseMirrorNodeJson): string {
  const src = node.attrs?.['src']
  const decoded = typeof src === 'string' ? decodeDataUrl(src) : null
  if (decoded === null) return ''

  const encoding = Object.entries(PICTURE_TYPES).find(([, type]) => type === decoded.extension)?.[0]
  // GIF, BMP and the rest have no RTF encoding that a reader is required to
  // understand; writing one as raw bytes would produce a broken picture.
  if (encoding === undefined) return ''

  let hex = ''
  for (const byte of decoded.bytes) hex += byte.toString(16).padStart(2, '0')

  const width = node.attrs?.['width']
  const height = node.attrs?.['height']
  const size = [
    typeof width === 'number' && width > 0
      ? `\\picwgoal${String(Math.round(width * TWIPS_PER_POINT))}`
      : '',
    typeof height === 'number' && height > 0
      ? `\\pichgoal${String(Math.round(height * TWIPS_PER_POINT))}`
      : '',
  ].join('')

  return `{\\pict\\${encoding}${size} ${hex}}`
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

  // The colour and font tables, which every run refers to by index.
  const colors: (string | null)[] = []
  const fonts = new Map<number, string>()

  let colorDepth: number | null = null
  let channels = { red: 0, green: 0, blue: 0 }
  let colorDeclared = false

  let fontDepth: number | null = null
  let fontId: number | null = null
  let fontName = ''

  let paragraph: ParagraphProperties = {
    textAlign: null,
    indentLeft: null,
    indentRight: null,
    indentFirstLine: null,
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
  }
  const resetParagraph = () => {
    paragraph = {
      textAlign: null,
      indentLeft: null,
      indentRight: null,
      indentFirstLine: null,
      spaceBefore: null,
      spaceAfter: null,
      lineHeight: null,
    }
  }

  // Set while reading a `\pict` group: the hex bytes, the encoding, and the
  // size the writer wants it displayed at.
  let pictureDepth: number | null = null
  let pictureHex = ''
  let pictureType: string | null = null
  let pictureWidth: number | null = null
  let pictureHeight: number | null = null

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

  const endColor = () => {
    // An entry with no channels is the "automatic" colour, which means the
    // reader's default rather than black.
    colors.push(colorDeclared ? rgbToHex(channels) : null)
    channels = { red: 0, green: 0, blue: 0 }
    colorDeclared = false
  }

  const endFont = () => {
    const name = fontName.trim().replace(/;$/u, '')
    if (fontId !== null && name !== '') fonts.set(fontId, name)
    fontName = ''
  }

  const emit = (value: string) => {
    if (colorDepth !== null) {
      for (const char of value) if (char === ';') endColor()
      return
    }

    if (fontDepth !== null) {
      for (const char of value) {
        if (char === ';') endFont()
        else fontName += char
      }
      return
    }

    // Inside a picture the stream is hex bytes, not text. Anything that is not
    // a hex digit there is whitespace the writer used to wrap long lines.
    if (pictureDepth !== null) {
      pictureHex += value.replace(/[^0-9a-f]/giu, '')
      return
    }
    if (markerDepth !== null) marker = (marker ?? '') + value
    else if (skipDepth === null) pendingText += value
  }

  /** Turns the bytes just read into an image node, or reports why it could not. */
  const endPicture = () => {
    if (pictureType === null) {
      warnings.push({
        tag: 'pict',
        message: 'A picture was left out because it is stored in a format this app cannot read.',
      })
    } else if (pictureHex.length >= 2) {
      current.push({
        type: 'image',
        attrs: {
          src: dataUrlFromHex(pictureHex, pictureType),
          alt: '',
          ...(pictureWidth === null ? {} : { width: pictureWidth }),
          ...(pictureHeight === null ? {} : { height: pictureHeight }),
          wrap: 'inline',
        },
      })
    }

    pictureHex = ''
    pictureType = null
    pictureWidth = null
    pictureHeight = null
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

    const isItem = marker !== null && headingLevel === null

    // On a list item the left indent and the hanging indent place the marker,
    // not the text; reading them as the user's own indent would double them.
    const properties = isItem
      ? { ...paragraph, indentLeft: null, indentFirstLine: null }
      : { ...paragraph, indentLeft: itemIndent === null ? null : itemIndent / TWIPS }

    const attrs = attributesFor(properties)

    const block: ProseMirrorNodeJson = {
      type: 'paragraph',
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(current.length > 0 ? { content: current } : {}),
    }

    if (isItem) {
      lists.addItem(kindOf(marker ?? ''), levelOf(itemLevel, itemIndent), [block], startOf(marker ?? ''))
    } else {
      lists.close()

      if (headingLevel !== null) {
        content.push({
          type: 'heading',
          attrs: { level: headingLevel, ...attrs },
          ...(current.length > 0 ? { content: current } : {}),
        })
      } else {
        content.push(block)
      }
    }

    current = []
    headingLevel = null
    marker = null
    itemLevel = null
    itemIndent = null
    resetParagraph()
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
      if (colorDepth !== null && depth <= colorDepth) colorDepth = null
      if (fontDepth !== null) {
        // The inner group closes one font; the outer one closes the table.
        endFont()
        if (depth <= fontDepth) fontDepth = null
      }
      if (pictureDepth !== null && depth <= pictureDepth) {
        pictureDepth = null
        endPicture()
      }
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

      if (word === 'colortbl') {
        colorDepth = depth
        continue
      }

      if (word === 'fonttbl') {
        fontDepth = depth
        continue
      }

      if (colorDepth !== null) {
        if (word === 'red' && parameter !== null) channels.red = parameter
        else if (word === 'green' && parameter !== null) channels.green = parameter
        else if (word === 'blue' && parameter !== null) channels.blue = parameter
        else continue
        colorDeclared = true
        continue
      }

      if (fontDepth !== null) {
        // Each font sits in its own group; `\f` opens one and the name follows.
        if (word === 'f' && parameter !== null) {
          endFont()
          fontId = parameter
        }
        continue
      }

      if (word === 'pict') {
        flushText()
        pictureDepth = depth
        continue
      }

      // A picture Word wraps in a shape. The `\*` before it says the group may
      // be ignored, but this one we can read, so the skip is called off.
      if (word === 'shppict') {
        if (skipDepth === depth) skipDepth = null
        continue
      }

      if (pictureDepth !== null) {
        const type = PICTURE_TYPES[word]
        if (type !== undefined) pictureType = type
        else if (word === 'picwgoal' && parameter !== null) {
          pictureWidth = Math.round((parameter / TWIPS_PER_POINT) * 100) / 100
        } else if (word === 'pichgoal' && parameter !== null) {
          pictureHeight = Math.round((parameter / TWIPS_PER_POINT) * 100) / 100
        }
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
          resetParagraph()
          break
        case 'ilvl':
          if (parameter !== null && parameter >= 0) itemLevel = parameter
          break
        case 'li':
          if (parameter !== null && parameter >= 0) itemIndent = parameter
          break
        case 'fi':
          if (parameter !== null) paragraph.indentFirstLine = parameter / TWIPS
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
        case 'cf':
          flushText()
          state = { ...state, color: parameter === null ? null : (colors[parameter] ?? null) }
          break
        case 'cb':
        case 'highlight':
          flushText()
          state = { ...state, highlight: parameter === null ? null : (colors[parameter] ?? null) }
          break
        case 'f':
          flushText()
          state = { ...state, fontFamily: parameter === null ? null : (fonts.get(parameter) ?? null) }
          break
        case 'fs':
          flushText()
          state = {
            ...state,
            fontSize:
              parameter === null || parameter <= 0 ? null : parameter / HALF_POINTS_PER_POINT,
          }
          break
        case 'ql':
        case 'qr':
        case 'qc':
        case 'qj':
          paragraph.textAlign = ALIGNMENTS[word] ?? null
          break
        case 'ri':
          if (parameter !== null) paragraph.indentRight = parameter / TWIPS
          break
        case 'sb':
          if (parameter !== null) paragraph.spaceBefore = parameter / TWIPS
          break
        case 'sa':
          if (parameter !== null) paragraph.spaceAfter = parameter / TWIPS
          break
        case 'sl':
          // A positive value with `\slmult1` is a multiple of a line; the exact
          // and at-least forms depend on the font and are left alone.
          if (parameter !== null && parameter > 0) paragraph.lineHeight = parameter / LINE_UNITS
          break
        case 'slmult':
          if (parameter === 0) paragraph.lineHeight = null
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

/**
 * The colour and font tables a document needs.
 *
 * RTF states both up front and every run refers to them by index, so the body
 * cannot be written until everything it uses is known. The tables are filled in
 * while the body is built and the header is composed afterwards.
 */
interface RtfTables {
  colorIndex: (hex: string) => number
  fontIndex: (family: string) => number
  header: () => string
}

const DEFAULT_FONT = 'Arial'
/** The document default, in points, which a run with its own size resets to. */
const DEFAULT_SIZE = 11

function createTables(): RtfTables {
  // Index zero is the reader's own colour, which is what a run resets to.
  const colors: string[] = []
  const fonts: string[] = [DEFAULT_FONT]

  return {
    colorIndex(hex) {
      const existing = colors.indexOf(hex)
      if (existing !== -1) return existing + 1

      colors.push(hex)
      return colors.length
    },

    fontIndex(family) {
      const existing = fonts.indexOf(family)
      if (existing !== -1) return existing

      fonts.push(family)
      return fonts.length - 1
    },

    header() {
      const fontTable = fonts
        .map((family, index) => `{\\f${String(index)} ${escapeRtf(family)};}`)
        .join('')

      const colorTable = colors
        .map((hex) => {
          const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) || 0
          return `\\red${String(channel(1))}\\green${String(channel(3))}\\blue${String(channel(5))};`
        })
        .join('')

      return `{\\fonttbl${fontTable}}{\\colortbl ;${colorTable}}`
    },
  }
}

/** Control words for a run's colour, font and size, and what resets them. */
function runProperties(
  node: ProseMirrorNodeJson,
  tables: RtfTables,
): { open: string[]; close: string[] } {
  const textStyle = node.marks?.find((mark) => mark.type === 'textStyle')?.attrs
  const highlight = node.marks?.find((mark) => mark.type === 'highlight')?.attrs?.['color']

  const open: string[] = []
  const close: string[] = []

  const color = textStyle?.['color']
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/iu.test(color)) {
    open.push(`\\cf${String(tables.colorIndex(color.toUpperCase()))} `)
    close.push('\\cf0 ')
  }

  if (typeof highlight === 'string' && /^#[0-9a-f]{6}$/iu.test(highlight)) {
    open.push(`\\highlight${String(tables.colorIndex(highlight.toUpperCase()))} `)
    close.push('\\highlight0 ')
  }

  const family = textStyle?.['fontFamily']
  if (typeof family === 'string' && family !== '') {
    open.push(`\\f${String(tables.fontIndex(family))} `)
    close.push('\\f0 ')
  }

  const size = textStyle?.['fontSize']
  if (typeof size === 'number' && size > 0) {
    open.push(`\\fs${String(Math.round(size * HALF_POINTS_PER_POINT))} `)
    close.push(`\\fs${String(DEFAULT_SIZE * HALF_POINTS_PER_POINT)} `)
  }

  return { open, close }
}

/** The control words for a block's own alignment, indents and spacing. */
function blockProperties(node: ProseMirrorNodeJson): string {
  const properties = propertiesOf(node)
  if (!hasProperties(properties)) return ''

  const twips = (value: number) => String(Math.round(value * TWIPS))
  const alignment =
    properties.textAlign === null
      ? undefined
      : Object.entries(ALIGNMENTS).find(([, name]) => name === properties.textAlign)?.[0]

  return [
    alignment === undefined ? '' : `\\${alignment}`,
    properties.indentLeft === null ? '' : `\\li${twips(properties.indentLeft)}`,
    properties.indentRight === null ? '' : `\\ri${twips(properties.indentRight)}`,
    properties.indentFirstLine === null ? '' : `\\fi${twips(properties.indentFirstLine)}`,
    properties.spaceBefore === null ? '' : `\\sb${twips(properties.spaceBefore)}`,
    properties.spaceAfter === null ? '' : `\\sa${twips(properties.spaceAfter)}`,
    // `\slmult1` is what makes the value a multiple of a line rather than an
    // exact height in twips.
    properties.lineHeight === null
      ? ''
      : `\\sl${String(Math.round(properties.lineHeight * LINE_UNITS))}\\slmult1`,
  ].join('')
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[], tables: RtfTables): string {
  return nodes
    .map((node) => {
      if (node.type === 'pageBreak') return '\\page '
      if (node.type === 'hardBreak') return '\\line '
      if (node.type === 'image') return pictureGroup(node)
      if (node.type !== 'text') return ''

      const marks = markNames(node)
      const { open, close } = runProperties(node, tables)

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
function listParagraphs(list: ProseMirrorNodeJson, level: number, tables: RtfTables): string[] {
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
        lines.push(...listParagraphs(child, level + 1, tables))
        continue
      }

      // No space before the text: after a closing brace a space is literal, and
      // the marker group already separates it from the indent control words.
      lines.push(`\\pard${indent}${marker}${serializeInline(child.content ?? [], tables)}\\par`)
    }
  })

  return lines
}

/** A table as RTF rows. Cells are laid out evenly across the text column. */
function tableRows(node: ProseMirrorNodeJson, tables: RtfTables): string {
  const flat = flattenTable(node, (block) => serializeInline(block.content ?? [], tables))
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
  const tables = createTables()

  for (const block of doc.content ?? []) {
    switch (block.type) {
      case 'heading': {
        const level = block.attrs?.['level']
        const outline = typeof level === 'number' ? level - 1 : 0
        blocks.push(
          `\\pard\\outlinelevel${String(outline)}${blockProperties(block)}\\b ${serializeInline(block.content ?? [], tables)}\\b0\\par`,
        )
        break
      }
      case 'paragraph':
        blocks.push(
          `\\pard${blockProperties(block)} ${serializeInline(block.content ?? [], tables)}\\par`,
        )
        break
      case 'bulletList':
      case 'orderedList':
        blocks.push(listParagraphs(block, 1, tables).join('\n'))
        break
      case 'table': {
        const rendered = tableRows(block, tables)
        if (rendered !== '') blocks.push(rendered)
        break
      }
      case 'image':
        blocks.push(`\\pard ${pictureGroup(block)}\\par`)
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

  // The header comes last: it declares the colours and fonts the body turned
  // out to use, which are only known once the body is written.
  return `{\\rtf1\\ansi\\deff0${tables.header()}\\fs${String(DEFAULT_SIZE * HALF_POINTS_PER_POINT)}\n${blocks.join('\n')}\n}`
}

export const rtfConverter: Converter = { parse: parseRtf, serialize: serializeRtf }
