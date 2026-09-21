import {
  attribute,
  attributes,
  children,
  deserializeNode,
  element,
  removeAttribute,
  removeChild,
  serializeNode,
  setAttribute,
  tagName,
  upsertChild,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { Shape } from './shape-tree'
import { propertiesOf, SHAPE_PROPERTIES } from './write-look'

/**
 * Copying how a shape looks onto another one.
 *
 * What travels is appearance and nothing else. The shape stays the shape it is:
 * painting a rectangle onto an arrow does not make it a rectangle, and it does
 * not move it or resize it either — geometry and transform are what the shape
 * *is*, not how it looks, and PowerPoint's own brush leaves both alone.
 *
 * The elements are carried as XML rather than as a parsed model on purpose. A
 * gradient with eight stops, a shadow, a picture fill with a crop: all of them
 * arrive intact without this having to understand any of them, which is the
 * same bargain the per-shape passthrough makes (ADR 0002).
 */

/** The `p:spPr` children that say how a shape looks, rather than what it is. */
const LOOK = [
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:blipFill',
  'a:pattFill',
  'a:grpFill',
  'a:ln',
  'a:effectLst',
  'a:scene3d',
  'a:sp3d',
]

/**
 * Run properties that are content rather than appearance.
 *
 * A hyperlink belongs to the words it is on; painting one shape's look onto
 * another must not hand it the first one's link. Word's brush does not carry
 * one either.
 */
const NOT_FORMATTING = ['a:hlinkClick', 'a:hlinkHover']

export interface ShapeFormat {
  /** Serialised fill, line and effects, in the order the schema wants them. */
  look: string[]
  /** Serialised `p:style` — the theme slots the shape falls back to. */
  style: string | null
  /** Serialised `a:pPr` from the first paragraph, or null when it states none. */
  paragraph: string | null
  /** Serialised `a:rPr` from the first run, or null. */
  run: string | null
}

const bodyOf = (shape: Shape): XmlNode | undefined =>
  children(shape.node).find((child) => tagName(child) === 'p:txBody')

const paragraphsOf = (shape: Shape): XmlNode[] => {
  const body = bodyOf(shape)
  return body === undefined ? [] : children(body).filter((child) => tagName(child) === 'a:p')
}

const RUNS = new Set(['a:r', 'a:fld'])

/** What the brush picks up from a shape, or null when it has nothing to give. */
export function copyShapeFormat(shape: Shape): ShapeFormat | null {
  const properties = propertiesOf(shape)
  if (properties === undefined) return null

  const first = paragraphsOf(shape)[0]
  const firstRun =
    first === undefined
      ? undefined
      : children(first).find((child) => RUNS.has(tagName(child) ?? ''))

  const runProperties =
    firstRun === undefined
      ? undefined
      : children(firstRun).find((child) => tagName(child) === 'a:rPr')

  return {
    look: children(properties)
      .filter((child) => LOOK.includes(tagName(child) ?? ''))
      .map((child) => serializeNode(child)),
    style: serialiseChild(shape.node, 'p:style'),
    paragraph: first === undefined ? null : serialiseChild(first, 'a:pPr'),
    run: runProperties === undefined ? null : serializeNode(runProperties),
  }
}

function serialiseChild(node: XmlNode, tag: string): string | null {
  const found = children(node).find((child) => tagName(child) === tag)
  return found === undefined ? null : serializeNode(found)
}

/** A clone of a serialised element, with the named children dropped. */
function restore(xml: string, without: readonly string[] = []): XmlNode | null {
  const node = deserializeNode(xml)
  if (node === null) return null
  for (const tag of without) removeChild(node, tag)
  return node
}

/**
 * Replaces one run's properties, keeping what belongs to the run itself.
 *
 * `lang` says what language the words are in, which the words decide and a
 * brush does not. Everything else in `a:rPr` is how they look.
 */
function paintRun(run: XmlNode, source: string): void {
  const existing = children(run).find((child) => tagName(child) === 'a:rPr')
  const painted = restore(source, NOT_FORMATTING)
  if (painted === null) return

  const language = existing === undefined ? undefined : attribute(existing, 'lang')
  if (language !== undefined) setAttribute(painted, 'lang', language)

  // A link on the run being painted is its own and stays; the source's was
  // dropped above rather than carried over.
  const link = existing === undefined ? undefined : findLink(existing)
  if (link !== undefined) children(painted).push(link)

  const nodes = children(run)
  const at = existing === undefined ? -1 : nodes.indexOf(existing)
  if (at === -1) nodes.unshift(painted)
  else nodes.splice(at, 1, painted)
}

const findLink = (properties: XmlNode): XmlNode | undefined =>
  children(properties).find((child) => NOT_FORMATTING.includes(tagName(child) ?? ''))

/**
 * The end-of-paragraph properties, which is where an empty paragraph keeps its
 * look — painting a box with no words in it and typing afterwards would
 * otherwise show none of what was painted.
 *
 * The language is the paragraph's own: its existing marker's, or the last run's
 * when it has none. A paragraph with neither is left stating no language at
 * all, which is closer to true than borrowing the source's.
 */
function paintEnd(paragraph: XmlNode, source: string): void {
  const painted = restore(source, NOT_FORMATTING)
  if (painted === null) return

  const existing = children(paragraph).find((child) => tagName(child) === 'a:endParaRPr')
  const lastRun = [...children(paragraph)].reverse().find((child) => RUNS.has(tagName(child) ?? ''))
  const runProperties =
    lastRun === undefined
      ? undefined
      : children(lastRun).find((child) => tagName(child) === 'a:rPr')

  const language =
    (existing === undefined ? undefined : attribute(existing, 'lang')) ??
    (runProperties === undefined ? undefined : attribute(runProperties, 'lang'))

  if (language === undefined) removeAttribute(painted, 'lang')
  else setAttribute(painted, 'lang', language)

  // Same properties under a different name: `a:endParaRPr` is an `a:rPr` that
  // describes the paragraph's end rather than any run in it.
  const renamed = element('a:endParaRPr', attributes(painted), children(painted))

  removeChild(paragraph, 'a:endParaRPr')
  children(paragraph).push(renamed)
}

/** Paints the held format onto a shape. Returns whether anything changed. */
export function applyShapeFormat(shape: Shape, format: ShapeFormat): boolean {
  const properties = propertiesOf(shape)
  if (properties === undefined) return false

  // Cleared first: a shape with a gradient painted over by one with none has to
  // lose the gradient, and upserting alone would leave it underneath.
  for (const tag of LOOK) removeChild(properties, tag)
  for (const xml of format.look) {
    const node = restore(xml)
    if (node !== null) upsertChild(properties, node, SHAPE_PROPERTIES)
  }

  removeChild(shape.node, 'p:style')
  if (format.style !== null) {
    const style = restore(format.style)
    // After `p:spPr` and before `p:txBody`, which is the order `p:sp` wants.
    if (style !== null) upsertChild(shape.node, style, SHAPE_ORDER)
  }

  for (const paragraph of paragraphsOf(shape)) {
    if (format.paragraph !== null) paintParagraph(paragraph, format.paragraph)

    if (format.run === null) continue
    for (const child of children(paragraph)) {
      if (RUNS.has(tagName(child) ?? '')) paintRun(child, format.run)
    }
    paintEnd(paragraph, format.run)
  }

  return true
}

/** `p:sp` in schema order, for putting `p:style` back where it belongs. */
const SHAPE_ORDER = ['p:nvSpPr', 'p:spPr', 'p:style', 'p:txBody']

/**
 * Replaces a paragraph's properties, keeping its outline level.
 *
 * The level is what the paragraph *is* — the second rung of a list is still the
 * second rung after it has been painted — while the alignment, the bullet and
 * the spacing are how it looks. Word's brush draws the line in the same place:
 * it does not turn a paragraph into a heading.
 */
function paintParagraph(paragraph: XmlNode, source: string): void {
  const existing = children(paragraph).find((child) => tagName(child) === 'a:pPr')
  const painted = restore(source)
  if (painted === null) return

  const level = existing === undefined ? undefined : attribute(existing, 'lvl')
  if (level === undefined) removeAttribute(painted, 'lvl')
  else setAttribute(painted, 'lvl', level)

  const nodes = children(paragraph)
  const at = existing === undefined ? -1 : nodes.indexOf(existing)
  if (at === -1) nodes.unshift(painted)
  else nodes.splice(at, 1, painted)
}
