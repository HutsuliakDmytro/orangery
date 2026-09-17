import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'
import type { ParseWarning } from '../../ooxml/parse-document'

/**
 * Format converters.
 *
 * Unlike DOCX, these formats carry no package to preserve: converting to them is
 * lossy by definition, and the app says so rather than pretending otherwise
 * (`isPreserving` in `formats.ts`). Every converter reports what it dropped.
 */

export interface ConversionResult {
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
}

export interface Converter {
  /** Text → ProseMirror. Must never throw: malformed input degrades. */
  parse: (text: string) => ConversionResult
  /** ProseMirror → text. */
  serialize: (doc: ProseMirrorNodeJson) => string
}

/** Marks a text node carries, as a set of names. */
export function markNames(node: ProseMirrorNodeJson): Set<string> {
  return new Set((node.marks ?? []).map((mark) => mark.type))
}

export function textContentOf(node: ProseMirrorNodeJson): string {
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(textContentOf).join('')
}

export function paragraph(text: string): ProseMirrorNodeJson {
  return text === ''
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: [{ type: 'text', text }] }
}

export function emptyDoc(): ProseMirrorNodeJson {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** ProseMirror rejects a doc with no blocks, so an empty result gets one. */
export function docOf(content: ProseMirrorNodeJson[]): ProseMirrorNodeJson {
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}
