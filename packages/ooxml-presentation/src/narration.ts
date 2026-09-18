import {
  addMedia,
  addRelationship,
  children,
  element,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import { relsPartFor } from './insert-picture'

/**
 * The sound of somebody talking over a slide.
 *
 * Written the way PowerPoint writes an embedded sound, because that is the way
 * this app's own reader already understands: `a:audioFile r:link` for the
 * original reference and `p14:media r:embed` beside it for the copy in the
 * package. Both point at the same bytes; the format grew the second one in 2010
 * and kept the first.
 *
 * The icon sits small in the corner. A narration is not something to look at,
 * and PowerPoint puts it there too.
 */

const AUDIO_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio'
const MEDIA_RELATIONSHIP = 'http://schemas.microsoft.com/office/2007/relationships/media'

const MEDIA_EXTENSION = '{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}'

/** A quarter inch square, a quarter inch in from the bottom left. */
const ICON = 228600

export interface Narration {
  bytes: Uint8Array
  /** Only the extension is used, which is what decides the content type. */
  fileName: string
  contentType: string
}

/**
 * Puts a recording on a slide. Returns the shape's id, or null.
 *
 * Two relationships to one part: the older reference and the newer embed. A
 * file carrying only one of them opens in something, but not in everything,
 * and the bytes are written once either way.
 */
export function addNarration(
  pkg: OoxmlPackage,
  slide: SlidePart,
  narration: Narration,
): number | null {
  if (narration.bytes.length === 0) return null

  const relsPart = relsPartFor(slide.path)
  const added = addMedia(pkg, {
    directory: 'ppt/media',
    relsPart,
    relationshipType: MEDIA_RELATIONSHIP,
    fileName: narration.fileName,
    bytes: narration.bytes,
    contentType: narration.contentType,
  })

  const relationships = parseRelationships(getPartText(pkg, relsPart) ?? '')
  const link = addRelationship(
    relationships,
    AUDIO_RELATIONSHIP,
    `../media/${added.path.split('/').pop() ?? narration.fileName}`,
  )
  setPartText(pkg, relsPart, serializeRelationships(relationships))

  const id = nextShapeId(slide)
  const node = element('p:pic', {}, [
    element('p:nvPicPr', {}, [
      element('p:cNvPr', { id: String(id), name: `Narration ${String(id)}` }, [
        // The action is what makes a click on the icon play it rather than
        // follow a link to nowhere.
        element('a:hlinkClick', { 'r:id': '', action: 'ppaction://media' }),
      ]),
      element('p:cNvPicPr', {}, [element('a:picLocks', { noChangeAspect: '1' })]),
      element('p:nvPr', {}, [
        element('a:audioFile', { 'r:link': link.id }),
        element('p:extLst', {}, [
          element('p:ext', { uri: MEDIA_EXTENSION }, [
            element('p14:media', {
              'xmlns:p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
              'r:embed': added.relationshipId,
            }),
          ]),
        ]),
      ]),
    ]),
    // No poster frame: a recording made here has no picture of itself, and an
    // empty fill is what PowerPoint shows as the speaker icon.
    element('p:blipFill', {}, [element('a:stretch', {}, [element('a:fillRect')])]),
    element('p:spPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: String(ICON), y: String(ICON) }),
        element('a:ext', { cx: String(ICON), cy: String(ICON) }),
      ]),
      element('a:prstGeom', { prst: 'rect' }, [element('a:avLst')]),
    ]),
  ])

  children(slide.tree).push(node)
  return id
}
