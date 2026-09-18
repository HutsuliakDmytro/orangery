import {
  addMedia,
  attribute,
  children,
  element,
  findChild,
  IMAGE_RELATIONSHIP,
  removeAttribute,
  removeChild,
  setAttribute,
  tagName,
  upsertChild,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import type { Fill } from '@orangery/ooxml-drawingml'
import type { SlidePart } from './deck'
import { relsPartFor, UnsupportedPictureError } from './insert-picture'
import { setFill } from './write-look'

/**
 * Changing what a slide is drawn on.
 *
 * Absent is not the same as none here either, and the difference is larger than
 * for a shape: a slide with no `p:bg` takes the layout's, which takes the
 * master's. So clearing the background removes the element — that is what "same
 * as the rest of the deck" means — while a background of none writes `a:noFill`
 * and stops the inheritance, leaving the slide transparent over nothing.
 */

/** `p:cSld` in schema order; the background comes before the shapes. */
const COMMON_SLIDE_DATA = ['p:bg', 'p:spTree', 'p:custDataLst', 'p:controls', 'p:extLst']

/** `p:bgPr` in schema order: a fill, then effects, both required. */
const BACKGROUND_PROPERTIES = [
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:blipFill',
  'a:pattFill',
  'a:grpFill',
  'a:effectLst',
  'a:effectDag',
  'a:extLst',
]

function commonOf(part: SlidePart): XmlNode | undefined {
  return findChild(part.root, 'p:cSld')
}

/** The `p:bgPr` of a part, made if it has none. */
function backgroundProperties(common: XmlNode): XmlNode {
  const background = findChild(common, 'p:bg') ?? element('p:bg')
  upsertChild(common, background, COMMON_SLIDE_DATA)

  // `p:bgRef` and `p:bgPr` are alternatives: stating a fill replaces a
  // reference into the theme rather than sitting beside it.
  removeChild(background, 'p:bgRef')

  const properties = findChild(background, 'p:bgPr') ?? element('p:bgPr')
  upsertChild(background, properties, ['p:bgPr', 'p:bgRef'])
  return properties
}

/**
 * Sets the background of a slide, layout or master.
 *
 * Passing null removes it, which sends the part back to inheriting — not the
 * same as a fill of none, which is why there is no `Fill` that means it.
 */
export function writeBackground(part: SlidePart, fill: Fill | null): boolean {
  const common = commonOf(part)
  if (common === undefined) return false

  if (fill === null) {
    if (findChild(common, 'p:bg') === undefined) return false
    removeChild(common, 'p:bg')
    return true
  }

  const properties = backgroundProperties(common)
  if (!setFill(properties, fill, BACKGROUND_PROPERTIES)) return false

  // `a:effectLst` is required by the schema even when it is empty; without it
  // PowerPoint offers to repair the file.
  if (
    !children(properties).some((child) => /^a:effect(Lst|Dag)$/u.test(tagName(child) ?? '')) //
  ) {
    upsertChild(properties, element('a:effectLst'), BACKGROUND_PROPERTIES)
  }
  return true
}

/**
 * Puts a picture behind a slide, adding the bytes to the package.
 *
 * Stretched to the slide rather than tiled, which is what "background picture"
 * means to everyone who asks for one; the tile is a separate choice the file
 * can express and nothing yet offers.
 */
export function writeBackgroundPicture(
  pkg: OoxmlPackage,
  part: SlidePart,
  picture: { fileName: string; bytes: Uint8Array },
): boolean {
  const contentType = contentTypeFor(picture.fileName)
  if (contentType === null) {
    throw new UnsupportedPictureError(`A deck cannot hold ${picture.fileName} pictures.`)
  }

  const common = commonOf(part)
  if (common === undefined) return false

  const added = addMedia(pkg, {
    directory: 'ppt/media',
    relsPart: relsPartFor(part.path),
    relationshipType: IMAGE_RELATIONSHIP,
    fileName: picture.fileName,
    contentType,
    bytes: picture.bytes,
  })

  const properties = backgroundProperties(common)
  for (const tag of ['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill']) {
    removeChild(properties, tag)
  }

  upsertChild(
    properties,
    element('a:blipFill', {}, [
      element('a:blip', { 'r:embed': added.relationshipId }),
      element('a:stretch', {}, [element('a:fillRect')]),
    ]),
    BACKGROUND_PROPERTIES,
  )
  upsertChild(properties, element('a:effectLst'), BACKGROUND_PROPERTIES)
  return true
}

/**
 * Whether the shapes the master draws show through on this slide.
 *
 * `showMasterSp` defaults to true, so hiding them writes `0` and showing them
 * again removes the attribute rather than writing `1` — a file says as little
 * as it can, and a deck that round-trips through here should not grow
 * attributes it did not have.
 */
export function showMasterShapes(part: SlidePart, show: boolean): boolean {
  const shown = masterShapesShown(part)
  if (shown === show) return false

  if (show) removeAttribute(part.root, 'showMasterSp')
  else setAttribute(part.root, 'showMasterSp', '0')
  return true
}

/** Whether the master's shapes show through on this part. */
export function masterShapesShown(part: SlidePart): boolean {
  return attribute(part.root, 'showMasterSp') !== '0'
}
