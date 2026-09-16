import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * The paragraph properties the editor models, shared by the text formats.
 *
 * ODT, HTML and RTF each spell them differently but mean the same six things,
 * and a converter that models a different subset from its neighbours loses
 * something on the way through. Measurements are in points and the line height
 * is a multiple of one line, which is how the editor and OOXML hold them.
 */
export interface ParagraphProperties {
  textAlign: string | null
  indentLeft: number | null
  indentRight: number | null
  /** Negative means a hanging indent, which is how Word states one. */
  indentFirstLine: number | null
  spaceBefore: number | null
  spaceAfter: number | null
  lineHeight: number | null
}

export const NO_PARAGRAPH_PROPERTIES: ParagraphProperties = {
  textAlign: null,
  indentLeft: null,
  indentRight: null,
  indentFirstLine: null,
  spaceBefore: null,
  spaceAfter: null,
  lineHeight: null,
}

const MEASURED = [
  'indentLeft',
  'indentRight',
  'indentFirstLine',
  'spaceBefore',
  'spaceAfter',
  'lineHeight',
] as const

/** Reads the properties a block node carries. */
export function propertiesOf(node: ProseMirrorNodeJson): ParagraphProperties {
  const attrs = node.attrs ?? {}
  const properties = { ...NO_PARAGRAPH_PROPERTIES }

  const align = attrs['textAlign']
  if (typeof align === 'string' && align !== '') properties.textAlign = align

  for (const name of MEASURED) {
    const value = attrs[name]
    // Zero is the absence of an indent, not an indent of nothing; writing it
    // out would override whatever the paragraph's style says.
    if (typeof value === 'number' && value !== 0) properties[name] = value
  }

  return properties
}

/** The attributes a block node needs to carry these properties. */
export function attributesFor(properties: ParagraphProperties): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}

  if (properties.textAlign !== null) attrs['textAlign'] = properties.textAlign
  for (const name of MEASURED) {
    if (properties[name] !== null) attrs[name] = properties[name]
  }

  return attrs
}

export function hasProperties(properties: ParagraphProperties): boolean {
  return Object.values(properties).some((value) => value !== null)
}
