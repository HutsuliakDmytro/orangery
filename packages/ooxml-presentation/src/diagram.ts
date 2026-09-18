import {
  attribute,
  children,
  getPartText,
  isTextNode,
  parseRelationships,
  parseXml,
  resolveTarget,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { relsPartFor } from './insert-picture'
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
  const text = part === null ? undefined : getPartText(pkg, part)
  if (text === undefined || frame.transform === null) return []

  const root = parseXml(text).find((node) => (tagName(node) ?? '').endsWith('drawing'))
  const tree =
    root === undefined
      ? undefined
      : children(root).find((child) => (tagName(child) ?? '').endsWith('spTree'))
  if (tree === undefined) return []

  const box = frame.transform
  const presented = asPresentation(tree)
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
