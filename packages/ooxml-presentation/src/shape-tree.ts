import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import {
  readBlipFill,
  readShapeProperties,
  readShapeStyle,
  readTextBody,
} from '@orangery/ooxml-drawingml'
import type { BlipFill, ShapeProperties, ShapeStyle, TextBody } from '@orangery/ooxml-drawingml'

/**
 * The shapes on a slide.
 *
 * Every shape keeps the node it was parsed from. That is not a convenience —
 * it is the preservation guarantee: a shape is edited by patching its own XML
 * and is never rebuilt from this model, because the model does not carry the
 * effects, 3-D, geometry adjustments and extension lists that came with it
 * (`apps/slides/docs/adr/0002-pptx-roundtrip.md`).
 */

/** The shape kinds a `p:spTree` can hold. */
export type ShapeKind = 'sp' | 'pic' | 'cxnSp' | 'graphicFrame' | 'grpSp' | 'unknown'

const KINDS: Readonly<Record<string, ShapeKind>> = {
  'p:sp': 'sp',
  'p:pic': 'pic',
  'p:cxnSp': 'cxnSp',
  'p:graphicFrame': 'graphicFrame',
  'p:grpSp': 'grpSp',
}

/** Position and size in EMU; rotation in 60000ths of a degree, as OOXML states it. */
export interface Transform {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
  /**
   * The coordinate space a group's children are expressed in.
   *
   * A group maps `chOff`/`chExt` onto `off`/`ext`, so a child at chOff sits at
   * the group's top-left however the group has been scaled. Null for anything
   * that is not a group.
   */
  child: { x: number; y: number; width: number; height: number } | null
}

/** Which placeholder on the layout this shape fills. */
export interface Placeholder {
  /** `title`, `body`, `ctrTitle`, `pic`, … Defaults to `body`, as the schema does. */
  type: string
  /** Position among same-typed placeholders; null when the shape is the only one. */
  index: number | null
}

/**
 * Where a connector's ends are pinned.
 *
 * `id` names a shape in the same tree and `index` a connection site on it —
 * which corner or edge. A connector also carries its own transform, so it can
 * be drawn without resolving these; they matter when the shape it is attached
 * to moves.
 */
export interface Connection {
  start: { shapeId: number; site: number } | null
  end: { shapeId: number; site: number } | null
}

export interface Shape {
  kind: ShapeKind
  /** Unique within the slide part. */
  id: number
  name: string
  /** Alt text, when the shape carries any. */
  description: string
  /**
   * Null when the shape states no transform of its own.
   *
   * For a placeholder that is the normal case, not a defect: position and size
   * come from the layout, and writing them into the slide would detach the
   * shape from it.
   */
  transform: Transform | null
  placeholder: Placeholder | null
  /**
   * Geometry, fill and line as the shape states them.
   *
   * Null where the shape has no properties element at all — a graphic frame,
   * for instance. Inside it, null again means "not stated": the shape takes
   * that property from its style reference or the placeholder it follows.
   */
  properties: ShapeProperties | null
  /** `p:style` — the theme slots the shape falls back to. */
  style: ShapeStyle | null
  /**
   * The text inside the shape, or null when it holds none.
   *
   * A picture and a connector have no text body at all; a shape that can hold
   * text always has one, even when it is empty.
   */
  text: TextBody | null
  /** The image, for a `p:pic`. Null for everything else. */
  picture: BlipFill | null
  /** What a connector is attached to, for a `p:cxnSp`. */
  connection: Connection | null
  /** Empty for everything that is not a group. */
  shapes: Shape[]
  /** The element this was read from. Written back as-is unless something edits it. */
  node: XmlNode
}

const number = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** The non-visual properties container, whose name differs per shape kind. */
function nonVisualOf(shape: XmlNode): XmlNode | undefined {
  return children(shape).find((child) => /^p:nv[A-Za-z]*Pr$/u.test(tagName(child) ?? ''))
}

/** The `p:spPr` / `p:grpSpPr` a shape states its look in, if it has one. */
function shapePropertiesOf(shape: XmlNode): XmlNode | undefined {
  return children(shape).find((child) => /^p:(sp|grpSp)Pr$/u.test(tagName(child) ?? ''))
}

/**
 * Where a shape states its geometry.
 *
 * `p:graphicFrame` is the odd one: its transform is a `p:xfrm` of its own
 * rather than an `a:xfrm` inside shape properties.
 */
function transformNodeOf(shape: XmlNode, kind: ShapeKind): XmlNode | undefined {
  if (kind === 'graphicFrame') return findChild(shape, 'p:xfrm')

  const properties = children(shape).find((child) =>
    /^p:(sp|grpSp|cxnSp)Pr$/u.test(tagName(child) ?? ''),
  )
  return properties === undefined ? undefined : findChild(properties, 'a:xfrm')
}

function parseTransform(xfrm: XmlNode | undefined): Transform | null {
  if (xfrm === undefined) return null

  const off = findChild(xfrm, 'a:off')
  const ext = findChild(xfrm, 'a:ext')
  const childOff = findChild(xfrm, 'a:chOff')
  const childExt = findChild(xfrm, 'a:chExt')

  return {
    x: number(off === undefined ? undefined : attribute(off, 'x')),
    y: number(off === undefined ? undefined : attribute(off, 'y')),
    width: number(ext === undefined ? undefined : attribute(ext, 'cx')),
    height: number(ext === undefined ? undefined : attribute(ext, 'cy')),
    rotation: number(attribute(xfrm, 'rot')),
    flipHorizontal: attribute(xfrm, 'flipH') === '1',
    flipVertical: attribute(xfrm, 'flipV') === '1',
    child:
      childOff === undefined && childExt === undefined
        ? null
        : {
            x: number(childOff === undefined ? undefined : attribute(childOff, 'x')),
            y: number(childOff === undefined ? undefined : attribute(childOff, 'y')),
            width: number(childExt === undefined ? undefined : attribute(childExt, 'cx')),
            height: number(childExt === undefined ? undefined : attribute(childExt, 'cy')),
          },
  }
}

function readConnection(nonVisual: XmlNode | undefined): Connection {
  const properties = nonVisual === undefined ? undefined : findChild(nonVisual, 'p:cNvCxnSpPr')

  const end = (tag: string) => {
    const element = properties === undefined ? undefined : findChild(properties, tag)
    if (element === undefined) return null

    const shapeId = Number(attribute(element, 'id'))
    const site = Number(attribute(element, 'idx'))
    return Number.isFinite(shapeId) ? { shapeId, site: Number.isFinite(site) ? site : 0 } : null
  }

  return { start: end('a:stCxn'), end: end('a:endCxn') }
}

function parsePlaceholder(nonVisual: XmlNode | undefined): Placeholder | null {
  const properties = nonVisual === undefined ? undefined : findChild(nonVisual, 'p:nvPr')
  const ph = properties === undefined ? undefined : findChild(properties, 'p:ph')
  if (ph === undefined) return null

  const index = attribute(ph, 'idx')

  return {
    // The schema's default, and what PowerPoint means by a bare `<p:ph/>`.
    type: attribute(ph, 'type') ?? 'body',
    index: index === undefined ? null : number(index),
  }
}

function parseShape(node: XmlNode): Shape {
  const kind = KINDS[tagName(node) ?? ''] ?? 'unknown'
  const nonVisual = nonVisualOf(node)
  const identity = nonVisual === undefined ? undefined : findChild(nonVisual, 'p:cNvPr')
  const propertiesNode = shapePropertiesOf(node)
  const styleNode = findChild(node, 'p:style')
  const textNode = findChild(node, 'p:txBody')
  const pictureNode = findChild(node, 'p:blipFill')

  return {
    kind,
    id: number(identity === undefined ? undefined : attribute(identity, 'id'), -1),
    name: (identity === undefined ? undefined : attribute(identity, 'name')) ?? '',
    description: (identity === undefined ? undefined : attribute(identity, 'descr')) ?? '',
    transform: parseTransform(transformNodeOf(node, kind)),
    placeholder: parsePlaceholder(nonVisual),
    properties: propertiesNode === undefined ? null : readShapeProperties(propertiesNode),
    style: styleNode === undefined ? null : readShapeStyle(styleNode),
    text: textNode === undefined ? null : readTextBody(textNode),
    picture: pictureNode === undefined ? null : readBlipFill(pictureNode),
    connection: kind === 'cxnSp' ? readConnection(nonVisual) : null,
    shapes: kind === 'grpSp' ? parseShapeTree(node) : [],
    node,
  }
}

/**
 * Reads the shapes out of a `p:spTree` or a `p:grpSp`.
 *
 * The tree's own non-visual and group properties are skipped: they describe the
 * container, not a shape on it.
 */
export function parseShapeTree(tree: XmlNode): Shape[] {
  return children(tree)
    .filter((child) => (tagName(child) ?? '') in KINDS)
    .map(parseShape)
}

/** Every shape in the tree, groups flattened, in document order. */
export function flatten(shapes: readonly Shape[]): Shape[] {
  return shapes.flatMap((shape) => [shape, ...flatten(shape.shapes)])
}
