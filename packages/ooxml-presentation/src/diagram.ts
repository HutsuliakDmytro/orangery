import {
  attribute,
  children,
  element,
  findDescendant,
  getPartText,
  isTextNode,
  parseRelationships,
  parseXml,
  resolveTarget,
  serializeRelationships,
  setAttribute,
  setPartText,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import { relsPartFor } from './insert-picture'
import type { SlidePart } from './deck'
import { parseShapeTree } from './shape-tree'
import type { Shape, Transform } from './shape-tree'

/**
 * Drawing SmartArt.
 *
 * A diagram states four parts — the data, the layout, the style and the colours
 * — and the layout is a small programming language for arranging nodes. Running
 * it would be writing an interpreter for a language whose only other
 * implementation is PowerPoint's.
 *
 * There is a fifth part, and it is the answer. PowerPoint writes the diagram it
 * drew as ordinary DrawingML shapes — `dsp:sp`, which is `p:sp` with a
 * different prefix — precisely so that something which cannot run the layout
 * can still show the picture. It is what LibreOffice reads too, and what a
 * PDF of the deck is made from.
 *
 * So the diagram is drawn from what PowerPoint drew. A diagram edited
 * elsewhere and never opened in PowerPoint has no such part, and that one is
 * still a labelled box — which is the honest answer, because nothing here knows
 * what it should look like.
 */

const DRAWING_RELATIONSHIP = 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing'

/**
 * The `dsp:` subtree as `p:`, which is the same elements under another prefix.
 *
 * A text node is handed back as it is. Its key is not a tag and its value is
 * not a list of children, so rebuilding it as an element would replace the
 * words with an empty array — which is a shape that reads as having no text
 * rather than a shape that fails to read.
 */
function asPresentation(node: XmlNode): XmlNode {
  const tag = tagName(node)
  if (tag === null || isTextNode(node)) return node

  const renamed = tag.startsWith('dsp:') ? `p:${tag.slice(4)}` : tag
  const copied: XmlNode = { [renamed]: children(node).map(asPresentation) }

  const attributes = node[':@']
  if (attributes !== undefined) copied[':@'] = attributes

  return copied
}

/** The `dsp:spTree` of a diagram's drawing, already renamed to `p:`. */
function drawingTree(pkg: OoxmlPackage, part: string): XmlNode | null {
  const text = getPartText(pkg, part)
  if (text === undefined) return null

  const root = parseXml(text).find((node) => (tagName(node) ?? '').endsWith('drawing'))
  const tree =
    root === undefined
      ? undefined
      : children(root).find((child) => (tagName(child) ?? '').endsWith('spTree'))

  return tree === undefined ? null : asPresentation(tree)
}

/** Every relationship of a part, resolved to package paths. */
function relationshipsOf(pkg: OoxmlPackage, part: string) {
  const directory = part.slice(0, part.lastIndexOf('/'))
  const text = getPartText(pkg, relsPartFor(part))
  if (text === undefined) return []

  return [...parseRelationships(text).values()].map((relationship) => ({
    ...relationship,
    target: relationship.external
      ? relationship.target
      : resolveTarget(relationship.target, directory),
  }))
}

/**
 * The part holding the shapes PowerPoint drew for a diagram.
 *
 * Named from the slide in some files and from the data part in others, because
 * the two versions that wrote them disagreed. Both are looked at: a reader that
 * knew one placement would draw half the decks in the world as empty boxes.
 */
export function diagramDrawingPart(
  pkg: OoxmlPackage,
  slidePath: string,
  dataId: string | null,
): string | null {
  const onSlide = relationshipsOf(pkg, slidePath)
  const drawing = onSlide.find((one) => one.type === DRAWING_RELATIONSHIP)
  if (drawing !== undefined) return drawing.target

  const data = dataId === null ? undefined : onSlide.find((one) => one.id === dataId)
  if (data === undefined) return null

  return (
    relationshipsOf(pkg, data.target).find((one) => one.type === DRAWING_RELATIONSHIP)?.target ??
    null
  )
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The box the drawing's own coordinates are written in. */
function childSpace(tree: XmlNode): Box | null {
  const properties = children(tree).find((child) => tagName(child) === 'p:grpSpPr')
  const transform =
    properties === undefined
      ? undefined
      : children(properties).find((child) => tagName(child) === 'a:xfrm')
  if (transform === undefined) return null

  const offset = children(transform).find((child) => tagName(child) === 'a:chOff')
  const extent = children(transform).find((child) => tagName(child) === 'a:chExt')
  if (offset === undefined || extent === undefined) return null

  const numbers = {
    x: Number(attribute(offset, 'x')),
    y: Number(attribute(offset, 'y')),
    width: Number(attribute(extent, 'cx')),
    height: Number(attribute(extent, 'cy')),
  }

  return Object.values(numbers).every((value) => Number.isFinite(value)) && numbers.width > 0
    ? numbers
    : null
}

/**
 * The shapes of a diagram, placed where they sit on the slide.
 *
 * Empty for a diagram with no drawing part, which is a diagram nobody has
 * opened in PowerPoint since it was made.
 */
export function readDiagramShapes(
  pkg: OoxmlPackage,
  slidePath: string,
  frame: { transform: Transform | null; dataId: string | null },
): Shape[] {
  const part = diagramDrawingPart(pkg, slidePath, frame.dataId)
  const presented = part === null ? null : drawingTree(pkg, part)
  if (presented === null || frame.transform === null) return []

  const box = frame.transform
  const shapes = parseShapeTree(presented)

  // A drawing that states no child space is written in the frame's own units
  // starting at nought, which is what PowerPoint writes for a diagram.
  const space = childSpace(presented) ?? { x: 0, y: 0, width: box.width, height: box.height }

  const scaleX = space.width === 0 ? 1 : box.width / space.width
  const scaleY = space.height === 0 ? 1 : box.height / space.height

  return shapes.map((shape) =>
    shape.transform === null
      ? shape
      : {
          ...shape,
          transform: {
            ...shape.transform,
            x: box.x + (shape.transform.x - space.x) * scaleX,
            y: box.y + (shape.transform.y - space.y) * scaleY,
            width: shape.transform.width * scaleX,
            height: shape.transform.height * scaleY,
          },
        },
  )
}

/** Whether any relationship in the package still names a part. */
function referenced(pkg: OoxmlPackage, path: string): boolean {
  for (const [relsPath, part] of pkg.parts) {
    if (!relsPath.endsWith('.rels') || part.text === undefined) continue

    const directory = relsPath.replace(/\/_rels\/[^/]+$/u, '')
    for (const relationship of parseRelationships(part.text).values()) {
      if (relationship.external) continue
      if (resolveTarget(relationship.target, directory) === path) return true
    }
  }

  return false
}

/** Drops a relationship, and the part it named when nothing else wants it. */
function forget(pkg: OoxmlPackage, from: string, id: string): void {
  const relsPart = relsPartFor(from)
  const relationships = parseRelationships(getPartText(pkg, relsPart) ?? '')
  const relationship = relationships.get(id)
  if (relationship === undefined) return

  const directory = from.slice(0, from.lastIndexOf('/'))
  const target = resolveTarget(relationship.target, directory)

  relationships.delete(id)
  setPartText(pkg, relsPart, serializeRelationships(relationships))

  // The part goes too when nothing else names it: an orphan in an OPC package
  // is what makes PowerPoint offer to repair the file.
  if (!referenced(pkg, target)) pkg.parts.delete(target)
}

/**
 * Turns a diagram into the shapes it is drawn as.
 *
 * The same thing PowerPoint's own "Convert to Shapes" does, and possible for
 * the same reason drawing one is possible at all: the picture is already in the
 * file as shapes. Nothing is invented — the nodes are the ones PowerPoint
 * wrote, under a prefix this app reads.
 *
 * They arrive as a group carrying the frame's box and the drawing's own
 * coordinate space, so no coordinate is rewritten: the group does the mapping
 * the frame was doing, which is what a group is for.
 *
 * Returns the group's id, or null for a diagram with no drawing behind it —
 * there is nothing to convert it into, and guessing would be inventing a
 * picture nobody has seen.
 */
export function convertDiagramToShapes(
  pkg: OoxmlPackage,
  slide: SlidePart,
  frame: Shape,
): number | null {
  const part = diagramDrawingPart(pkg, slide.path, frame.graphic?.relationshipId ?? null)
  const tree = part === null ? null : drawingTree(pkg, part)
  if (tree === null || frame.transform === null) return null

  const members = children(tree).filter(
    (child) => !/^p:(nvGrpSpPr|grpSpPr)$/u.test(tagName(child) ?? ''),
  )
  if (members.length === 0) return null

  const box = frame.transform
  const space = childSpace(tree) ?? { x: 0, y: 0, width: box.width, height: box.height }
  const round = (value: number) => String(Math.round(value))

  let id = nextShapeId(slide)
  const groupId = id

  // Ids are unique per part, and the drawing's were unique only within itself;
  // two shapes sharing one is a file PowerPoint refuses.
  for (const member of members) {
    const identity = findDescendant(member, 'p:cNvPr')
    if (identity === undefined) continue
    id += 1
    setAttribute(identity, 'id', String(id))
  }

  const group = element('p:grpSp', {}, [
    element('p:nvGrpSpPr', {}, [
      element('p:cNvPr', { id: String(groupId), name: `Diagram ${String(groupId)}` }),
      element('p:cNvGrpSpPr'),
      element('p:nvPr'),
    ]),
    element('p:grpSpPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: round(box.x), y: round(box.y) }),
        element('a:ext', { cx: round(box.width), cy: round(box.height) }),
        element('a:chOff', { x: round(space.x), y: round(space.y) }),
        element('a:chExt', { cx: round(space.width), cy: round(space.height) }),
      ]),
    ]),
    ...members,
  ])

  const siblings = children(slide.tree)
  const at = siblings.indexOf(frame.node)
  if (at === -1) return null
  siblings.splice(at, 1, group)

  // The diagram's own parts are nobody's now. Left behind they would be four
  // files the deck carries and never opens.
  for (const relationship of relationshipsOf(pkg, slide.path)) {
    if (relationship.target.startsWith('ppt/diagrams/')) forget(pkg, slide.path, relationship.id)
  }

  return groupId
}
