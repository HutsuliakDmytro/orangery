import {
  attribute,
  children,
  findChild,
  parseIntAttribute,
  parseXml,
  tagName,
  twipsToPoints,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * `word/numbering.xml` → list definitions.
 *
 * OOXML splits numbering in two: `w:abstractNum` holds the definition (one entry
 * per level) and `w:num` is an instance pointing at it, optionally overriding
 * levels. A paragraph references the *instance*, so rendering a list means
 * following numId → abstractNumId → the level entry.
 */

/** `w:numFmt` values. Anything else is preserved but rendered as a plain bullet. */
export type NumberFormat =
  | 'bullet'
  | 'decimal'
  | 'lowerLetter'
  | 'upperLetter'
  | 'lowerRoman'
  | 'upperRoman'
  | 'none'
  | 'other'

export interface NumberingLevel {
  level: number
  format: NumberFormat
  /** Template such as `%1.` or a bullet glyph like `•`. */
  text: string
  /** 1 unless the list starts elsewhere. */
  start: number
  indentLeft: number | null
  indentHanging: number | null
  /** Font the bullet glyph is drawn in; Symbol and Wingdings are common. */
  bulletFont: string | null
}

export interface AbstractNumbering {
  id: number
  levels: Map<number, NumberingLevel>
}

export interface NumberingInstance {
  numId: number
  abstractNumId: number
  /** Level overrides declared on the instance itself. */
  overrides: Map<number, NumberingLevel>
}

export interface NumberingCatalogue {
  abstract: Map<number, AbstractNumbering>
  instances: Map<number, NumberingInstance>
}

function parseFormat(value: string | undefined): NumberFormat {
  switch (value) {
    case 'bullet':
    case 'decimal':
    case 'lowerLetter':
    case 'upperLetter':
    case 'lowerRoman':
    case 'upperRoman':
    case 'none':
      return value
    default:
      return 'other'
  }
}

function parseLevel(node: XmlNode): NumberingLevel | null {
  const level = parseIntAttribute(attribute(node, 'w:ilvl'))
  if (level === null) return null

  const indent = findChild(findChild(node, 'w:pPr') ?? {}, 'w:ind')
  const left = indent
    ? parseIntAttribute(attribute(indent, 'w:left') ?? attribute(indent, 'w:start'))
    : null
  const hanging = indent ? parseIntAttribute(attribute(indent, 'w:hanging')) : null

  return {
    level,
    format: parseFormat(attribute(findChild(node, 'w:numFmt') ?? {}, 'w:val')),
    text: attribute(findChild(node, 'w:lvlText') ?? {}, 'w:val') ?? '',
    start: parseIntAttribute(attribute(findChild(node, 'w:start') ?? {}, 'w:val')) ?? 1,
    indentLeft: left === null ? null : twipsToPoints(left),
    indentHanging: hanging === null ? null : twipsToPoints(hanging),
    bulletFont:
      attribute(findChild(findChild(node, 'w:rPr') ?? {}, 'w:rFonts') ?? {}, 'w:ascii') ?? null,
  }
}

export function parseNumbering(xml: string): NumberingCatalogue {
  const catalogue: NumberingCatalogue = { abstract: new Map(), instances: new Map() }

  const root = parseXml(xml).find((node) => tagName(node) === 'w:numbering')
  if (!root) return catalogue

  for (const node of children(root)) {
    const tag = tagName(node)

    if (tag === 'w:abstractNum') {
      const id = parseIntAttribute(attribute(node, 'w:abstractNumId'))
      if (id === null) continue

      const levels = new Map<number, NumberingLevel>()
      for (const child of children(node)) {
        if (tagName(child) !== 'w:lvl') continue
        const level = parseLevel(child)
        if (level) levels.set(level.level, level)
      }

      catalogue.abstract.set(id, { id, levels })
      continue
    }

    if (tag === 'w:num') {
      const numId = parseIntAttribute(attribute(node, 'w:numId'))
      const abstractNumId = parseIntAttribute(
        attribute(findChild(node, 'w:abstractNumId') ?? {}, 'w:val'),
      )
      if (numId === null || abstractNumId === null) continue

      const overrides = new Map<number, NumberingLevel>()
      for (const child of children(node)) {
        if (tagName(child) !== 'w:lvlOverride') continue
        const override = findChild(child, 'w:lvl')
        const parsed = override ? parseLevel(override) : null
        if (parsed) overrides.set(parsed.level, parsed)
      }

      catalogue.instances.set(numId, { numId, abstractNumId, overrides })
    }
  }

  return catalogue
}

/** Resolves numId + level to its definition, honouring instance overrides. */
export function resolveNumbering(
  catalogue: NumberingCatalogue,
  numId: number,
  level: number,
): NumberingLevel | null {
  const instance = catalogue.instances.get(numId)
  if (!instance) return null

  const override = instance.overrides.get(level)
  if (override) return override

  return catalogue.abstract.get(instance.abstractNumId)?.levels.get(level) ?? null
}

/** Whether a numbering reference renders as a bullet rather than a number. */
export function isBulletList(catalogue: NumberingCatalogue, numId: number, level: number): boolean {
  const definition = resolveNumbering(catalogue, numId, level)
  if (!definition) return true
  return definition.format === 'bullet' || definition.format === 'none'
}

/** Smallest unused numId, for creating a list in a document that has none. */
export function nextNumId(catalogue: NumberingCatalogue): number {
  let candidate = 1
  while (catalogue.instances.has(candidate)) candidate += 1
  return candidate
}

export function nextAbstractNumId(catalogue: NumberingCatalogue): number {
  let candidate = 0
  while (catalogue.abstract.has(candidate)) candidate += 1
  return candidate
}
