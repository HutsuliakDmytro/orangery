import { getPartText, setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { STYLES_PART } from '../ooxml/parts'
import type { Editor } from '@tiptap/core'
import { freeStyleId, upsertStyle } from '../ooxml/style-writer'
import type { StyleDefinition } from '../ooxml/style-writer'
import { parseStyles } from '../ooxml/styles'
import type { StyleCatalogue, StyleFormatting, StyleType } from '../ooxml/styles'

/**
 * Making a style out of what the cursor is sitting in.
 *
 * "Update to match the selection" and "new style from the selection" are the
 * same reading of the document, differing only in which style it is written to.
 */

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The formatting in force where the cursor is.
 *
 * Read from the marks and the block's own attributes, which is what the user
 * has actually applied — not from the style underneath, which is what they are
 * about to replace.
 */
export function formattingAt(editor: Editor, type: StyleType): StyleFormatting {
  const marks = editor.getAttributes('textStyle')
  const formatting: StyleFormatting = {}

  if (editor.isActive('bold')) formatting.bold = true
  if (editor.isActive('italic')) formatting.italic = true
  if (editor.isActive('underline')) formatting.underline = true
  if (editor.isActive('strike')) formatting.strike = true

  const fontFamily = stringOf(marks['fontFamily'])
  if (fontFamily !== undefined) formatting.fontFamily = fontFamily

  const fontSize = numberOf(marks['fontSize'])
  if (fontSize !== undefined) formatting.fontSize = fontSize

  const color = stringOf(marks['color'])
  if (color !== undefined) formatting.color = color

  // A character style says nothing about the paragraph it sits in.
  if (type !== 'paragraph') return formatting

  const block = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph')

  const textAlign = stringOf(block['textAlign'])
  if (textAlign !== undefined) formatting.textAlign = textAlign

  for (const name of ['lineHeight', 'spaceBefore', 'spaceAfter', 'indentLeft'] as const) {
    const value = numberOf(block[name])
    if (value !== undefined) formatting[name] = value
  }

  const firstLine = numberOf(block['indentFirstLine'])
  if (firstLine !== undefined) formatting.indentFirstLine = firstLine

  return formatting
}

export interface SavedStyle {
  definition: StyleDefinition
  catalogue: StyleCatalogue
}

/**
 * Writes a style into the package and hands back the catalogue as it now is.
 *
 * Returns null when the document has no styles part to write into, which is a
 * document that is not a DOCX rather than an error.
 */
export function saveStyle(pkg: OoxmlPackage, definition: StyleDefinition): SavedStyle | null {
  const xml = getPartText(pkg, STYLES_PART)
  if (xml === undefined) return null

  const updated = upsertStyle(xml, definition)
  setPartText(pkg, STYLES_PART, updated)

  return { definition, catalogue: parseStyles(updated) }
}

/** A definition for a style the document does not have yet. */
export function newStyleFrom(
  pkg: OoxmlPackage,
  editor: Editor,
  name: string,
  type: StyleType,
): StyleDefinition {
  const xml = getPartText(pkg, STYLES_PART) ?? ''

  return {
    id: freeStyleId(xml, name),
    name,
    type,
    // Based on the default so the new style inherits the document's own fonts
    // and spacing rather than starting from Word's.
    basedOn: type === 'paragraph' ? (parseStyles(xml).defaultParagraphStyleId ?? null) : null,
    next: type === 'paragraph' ? 'Normal' : null,
    formatting: formattingAt(editor, type),
  }
}
