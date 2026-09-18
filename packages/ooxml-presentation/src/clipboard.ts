import {
  addMedia,
  attribute,
  children,
  deserializeNode,
  removeAttribute,
  serializeNode,
  setAttribute,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import { parseShape } from './shape-tree'
import type { Shape } from './shape-tree'
import type { SlidePart } from './deck'
import { relsPartFor } from './insert-picture'
import { nextShapeId, offsetShape } from './arrange'
import { relationshipTarget } from './presentation'

/**
 * Shapes on the clipboard.
 *
 * The whole XML subtree travels, not a reading of it — so a shape pasted into
 * another deck keeps its effects, its extension lists and everything else this
 * model never looked at, exactly as duplicating one within a slide already
 * does.
 *
 * What cannot travel as XML is what the XML points at. A picture's `r:embed`
 * names a relationship in the slide it was copied from, and that slide may be
 * in a file the other window has never heard of — so the bytes come along and
 * the relationship is made again on arrival.
 */

/** The marker that says a piece of clipboard text is ours. */
export const CLIPBOARD_KIND = 'orangery/slides-shapes'

const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

export interface ClipboardMedia {
  /** The name it had, which is only used for its extension. */
  name: string
  /** Base64, because a clipboard carries text. */
  data: string
}

export interface ClipboardShapes {
  kind: typeof CLIPBOARD_KIND
  version: 1
  /** Each shape as its own XML. */
  shapes: string[]
  /** Media by the relationship id the shapes refer to it by. */
  media: Record<string, ClipboardMedia>
}

/** Attributes that name a relationship rather than a value. */
const RELATIONSHIP_ATTRIBUTES = [
  'r:embed',
  'r:link',
  'r:id',
  'r:pict',
  'r:dm',
  'r:lo',
  'r:qs',
  'r:cs',
]

/** Every relationship id a subtree mentions, wherever it mentions it. */
function relationshipsIn(node: XmlNode): string[] {
  const found: string[] = []

  const walk = (current: XmlNode) => {
    for (const name of RELATIONSHIP_ATTRIBUTES) {
      const id = attribute(current, name)
      if (id !== undefined && id !== '') found.push(id)
    }
    for (const child of children(current)) walk(child)
  }

  walk(node)
  return found
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(binary)
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Puts shapes on the clipboard, with whatever they point at. */
export function copyShapes(
  pkg: OoxmlPackage,
  part: string,
  shapes: readonly Shape[],
): ClipboardShapes {
  const media: Record<string, ClipboardMedia> = {}

  for (const shape of shapes) {
    for (const id of relationshipsIn(shape.node)) {
      if (id in media) continue

      const target = relationshipTarget(pkg, part, id)
      const found = target === null ? undefined : pkg.parts.get(target)
      // A relationship to something that is not a file in this package — a web
      // link, a slide — has nothing to carry. It is dropped on arrival rather
      // than pasted as a reference into a deck where it means something else.
      if (target === null || found === undefined) continue

      media[id] = { name: target.split('/').pop() ?? 'image.png', data: encodeBase64(found.bytes) }
    }
  }

  return {
    kind: CLIPBOARD_KIND,
    version: 1,
    shapes: shapes.map((shape) => serializeNode(shape.node)),
    media,
  }
}

/** Rejects anything that is not shapes this build put on the clipboard. */
export function parseClipboard(text: string): ClipboardShapes | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>

  if (candidate['kind'] !== CLIPBOARD_KIND || candidate['version'] !== 1) return null

  const shapes = candidate['shapes']
  if (!Array.isArray(shapes) || shapes.some((one) => typeof one !== 'string')) return null

  const media: Record<string, ClipboardMedia> = {}
  const rawMedia = candidate['media']
  if (typeof rawMedia === 'object' && rawMedia !== null) {
    for (const [id, value] of Object.entries(rawMedia as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as Record<string, unknown>
      if (typeof entry['name'] === 'string' && typeof entry['data'] === 'string') {
        media[id] = { name: entry['name'], data: entry['data'] }
      }
    }
  }

  return { kind: CLIPBOARD_KIND, version: 1, shapes: shapes as string[], media }
}

/** Points every relationship in a subtree at this package, or unhooks it. */
function rehome(node: XmlNode, moved: ReadonlyMap<string, string>): void {
  const walk = (current: XmlNode) => {
    for (const name of RELATIONSHIP_ATTRIBUTES) {
      const id = attribute(current, name)
      if (id === undefined || id === '') continue

      const replacement = moved.get(id)
      // Nothing to point at here. Removed rather than left dangling: a
      // relationship id that names nothing is the file PowerPoint offers to
      // repair, and a picture that does not draw is a better outcome than that.
      if (replacement === undefined) removeAttribute(current, name)
      else setAttribute(current, name, replacement)
    }
    for (const child of children(current)) walk(child)
  }

  walk(node)
}

export interface PasteOptions {
  /**
   * How far to move what is pasted, in EMU.
   *
   * Pasting onto the slide the shapes were copied from puts them beside the
   * originals, because two shapes in the same place look like one and the
   * person would think nothing happened. Pasting onto a different slide keeps
   * the position, because there is nothing there to be confused with.
   */
  offset: { x: number; y: number }
}

/** Puts clipboard shapes onto a slide, and answers with their new ids. */
export function pasteShapes(
  pkg: OoxmlPackage,
  part: SlidePart,
  payload: ClipboardShapes,
  options: PasteOptions,
): number[] {
  const added: number[] = []
  const moved = new Map<string, string>()

  // Counted here rather than asked for each time: `nextShapeId` reads the part
  // as it was parsed, and the shapes being pasted are not in that reading — so
  // asking twice would answer the same twice, and two shapes would share an id.
  let nextId = nextShapeId(part)

  for (const [id, entry] of Object.entries(payload.media)) {
    const contentType = contentTypeFor(entry.name)
    if (contentType === null) continue

    const media = addMedia(pkg, {
      directory: 'ppt/media',
      relsPart: relsPartFor(part.path),
      relationshipType: IMAGE_RELATIONSHIP,
      fileName: entry.name,
      bytes: decodeBase64(entry.data),
      contentType,
    })
    moved.set(id, media.relationshipId)
  }

  for (const xml of payload.shapes) {
    const node = deserializeNode(xml)
    if (node === null) continue

    rehome(node, moved)
    children(part.tree).push(node)

    // A fresh id, free in the part it is arriving in rather than in the one it
    // came from: two shapes sharing an id is a file PowerPoint rejects.
    const id = nextId
    nextId += 1
    setShapeId(node, id)
    added.push(id)

    if (options.offset.x !== 0 || options.offset.y !== 0) {
      // Read back from the node now that it has an id, because moving it writes
      // through the shape rather than through the XML directly.
      offsetShape(parseShape(node), options.offset)
    }
  }

  return added
}

/** Writes a shape's id into the non-visual properties, whatever kind it is. */
function setShapeId(node: XmlNode, id: number): void {
  const walk = (current: XmlNode): boolean => {
    for (const child of children(current)) {
      // `p:cNvPr`, `a:cNvPr` — the prefix differs by what the shape is, and the
      // id lives on all of them.
      if (tagName(child)?.endsWith('cNvPr') === true) {
        setAttribute(child, 'id', String(id))
        return true
      }
      if (walk(child)) return true
    }
    return false
  }

  walk(node)
}
