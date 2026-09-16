import { docOf, paragraph, textContentOf } from './types'
import type { ConversionResult, Converter } from './types'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * Plain text.
 *
 * One line becomes one paragraph. Blank lines are kept as empty paragraphs
 * rather than collapsed, because in a plain-text document they are the only
 * paragraph spacing there is.
 */

/** Accepts CRLF, LF and the lone CR that old Mac files still use. */
const LINE_BREAK = /\r\n|\r|\n/u

export function parseText(text: string): ConversionResult {
  // A trailing newline denotes the end of the last line, not an extra empty one.
  const body = text.replace(/(\r\n|\r|\n)$/u, '')
  const lines = body === '' ? [] : body.split(LINE_BREAK)

  return { doc: docOf(lines.map(paragraph)), warnings: [] }
}

export function serializeText(doc: ProseMirrorNodeJson): string {
  const lines: string[] = []

  for (const block of doc.content ?? []) {
    switch (block.type) {
      case 'passthroughBlock':
        // Nothing meaningful to write: the construct has no plain-text form.
        break
      case 'pageBreak':
        lines.push('\f')
        break
      default:
        lines.push(textContentOf(block))
    }
  }

  return lines.join('\n')
}

export const textConverter: Converter = { parse: parseText, serialize: serializeText }
