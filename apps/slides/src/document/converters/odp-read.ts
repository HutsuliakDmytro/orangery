import {
  attribute,
  children,
  findChild,
  findDescendant,
  isTextNode,
  parseXml,
  readPackage,
  tagName,
  textValue,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { TextLine } from '@orangery/ooxml-presentation'
import { lengthToEmu } from './lengths'

/**
 * Reading an OpenDocument Presentation.
 *
 * ODP is a conversion, not a second native format. Docs can keep an ODT as an
 * ODT because a document is text either way; a deck is a package of masters,
 * layouts and placeholders whose inheritance every renderer, command and editor
 * in this app resolves — a second model behind all of that is not a file
 * format, it is a second application.
 *
 * So what comes out of here is a description flat enough to build a real PPTX
 * from: pages, frames, and what is in them, at the position the file gives. The
 * frames are placed absolutely rather than mapped onto our placeholders,
 * because an import should show what the file said and not what our master
 * would have preferred.
 */

export const ODP_MIME_TYPE = 'application/vnd.oasis.opendocument.presentation'

export interface OdpFrame {
  /** EMU, from the page's top-left corner. */
  x: number
  y: number
  width: number
  height: number
}

export interface OdpText extends OdpFrame {
  kind: 'text'
  lines: TextLine[]
}

export interface OdpPicture extends OdpFrame {
  kind: 'picture'
  /** The name the picture had inside the ODP, for its extension. */
  name: string
  bytes: Uint8Array
}

export type OdpShape = OdpText | OdpPicture

export interface OdpPage {
  name: string | null
  shapes: OdpShape[]
}

export interface OdpDeck {
  /** EMU; null when the file does not say and the default should be used. */
  size: { width: number; height: number } | null
  pages: OdpPage[]
  /** What was in the file and is not in the result. */
  skipped: number
}

export class NotAnOdpError extends Error {
  override readonly name = 'NotAnOdpError'
}

/** Every descendant with this tag, in document order. */
function descendants(node: XmlNode, tag: string): XmlNode[] {
  const found: XmlNode[] = []

  const walk = (current: XmlNode) => {
    for (const child of children(current)) {
      if (tagName(child) === tag) found.push(child)
      walk(child)
    }
  }

  walk(node)
  return found
}

/** All the text under a node, which is what a paragraph's spans add up to. */
function textOf(node: XmlNode): string {
  let text = ''

  const walk = (current: XmlNode) => {
    for (const child of children(current)) {
      if (isTextNode(child)) {
        text += textValue(child)
        continue
      }
      // A run of spaces is written as an element with a count, because XML
      // collapses them otherwise and OpenDocument would rather not lose them.
      if (tagName(child) === 'text:s') {
        text += ' '.repeat(Number(attribute(child, 'text:c') ?? '1') || 1)
        continue
      }
      if (tagName(child) === 'text:tab') {
        text += '\t'
        continue
      }
      if (tagName(child) === 'text:line-break') {
        text += '\n'
        continue
      }
      walk(child)
    }
  }

  walk(node)
  return text
}

/**
 * The paragraphs of a text box, with the level each sits at.
 *
 * Indentation in OpenDocument is nesting: a second-level bullet is a `text:p`
 * inside a `text:list` inside a `text:list-item` inside another `text:list`.
 * PresentationML states the level as a number instead, so the nesting is
 * counted on the way past.
 */
function linesOf(box: XmlNode): TextLine[] {
  const lines: TextLine[] = []

  const walk = (node: XmlNode, level: number) => {
    for (const child of children(node)) {
      if (isTextNode(child)) continue
      const tag = tagName(child)

      if (tag === 'text:p') {
        lines.push({ text: textOf(child), level })
        continue
      }
      if (tag === 'text:list') {
        walk(child, level + 1)
        continue
      }
      if (tag === 'text:list-item') {
        walk(child, level)
        continue
      }
      walk(child, level)
    }
  }

  // The outermost list is level one of nesting but level zero of outline, so
  // counting starts below zero and the first list brings it to nothing.
  walk(box, -1)
  return lines.map((line) => ({ ...line, level: Math.max(line.level ?? 0, 0) }))
}

function frameOf(frame: XmlNode): OdpFrame | null {
  const width = lengthToEmu(attribute(frame, 'svg:width'))
  const height = lengthToEmu(attribute(frame, 'svg:height'))
  if (width === null || height === null) return null

  return {
    x: lengthToEmu(attribute(frame, 'svg:x')) ?? 0,
    y: lengthToEmu(attribute(frame, 'svg:y')) ?? 0,
    width,
    height,
  }
}

/** The page size, which lives in the master page's layout in `styles.xml`. */
function sizeOf(styles: string): { width: number; height: number } | null {
  const root = parseXml(styles).find((node) => tagName(node) === 'office:document-styles')
  if (root === undefined) return null

  const properties = findDescendant(root, 'style:page-layout-properties')
  if (properties === undefined) return null

  const width = lengthToEmu(attribute(properties, 'fo:page-width'))
  const height = lengthToEmu(attribute(properties, 'fo:page-height'))
  return width === null || height === null ? null : { width, height }
}

function shapesOf(
  page: XmlNode,
  pictures: Map<string, Uint8Array>,
): {
  shapes: OdpShape[]
  skipped: number
} {
  const shapes: OdpShape[] = []
  let skipped = 0

  for (const frame of descendants(page, 'draw:frame')) {
    // Notes are a page of their own inside the page, and the frames in it are
    // not on the slide. Left for later rather than dropped silently: the count
    // says something went unread.
    if (findDescendant(page, 'presentation:notes') !== undefined) {
      const notes = findDescendant(page, 'presentation:notes')
      if (notes !== undefined && descendants(notes, 'draw:frame').includes(frame)) continue
    }

    const box = frameOf(frame)
    if (box === null) {
      skipped += 1
      continue
    }

    const image = findChild(frame, 'draw:image')
    if (image !== undefined) {
      const href = attribute(image, 'xlink:href') ?? ''
      const bytes = pictures.get(href.replace(/^\.\//u, ''))
      if (bytes === undefined) {
        // A linked picture, living outside the package. There is nothing to
        // carry across, and inventing a grey box would be a worse answer.
        skipped += 1
        continue
      }
      shapes.push({ kind: 'picture', ...box, name: href.split('/').pop() ?? href, bytes })
      continue
    }

    const textBox = findChild(frame, 'draw:text-box')
    if (textBox !== undefined) {
      shapes.push({ kind: 'text', ...box, lines: linesOf(textBox) })
      continue
    }

    skipped += 1
  }

  // Everything that is not a frame at all: drawn shapes, connectors, charts,
  // embedded objects. Counted so the person is told rather than left to notice.
  for (const tag of ['draw:custom-shape', 'draw:rect', 'draw:ellipse', 'draw:line', 'draw:path']) {
    skipped += descendants(page, tag).length
  }

  return { shapes, skipped }
}

/** Reads an `.odp` into something a deck can be built from. */
export async function readOdp(data: Uint8Array): Promise<OdpDeck> {
  // The same zip reader the PPTX side uses: a package of parts is a package of
  // parts, and OpenDocument differs in what the parts are called.
  const pkg = await readPackage(data)

  const contentText = pkg.parts.get('content.xml')?.text
  if (contentText === undefined) {
    throw new NotAnOdpError('not a presentation: content.xml is missing')
  }

  const pictures = new Map<string, Uint8Array>()
  for (const part of pkg.parts.values()) {
    if (part.path.startsWith('Pictures/')) pictures.set(part.path, part.bytes)
  }

  const content = parseXml(contentText).find((node) => tagName(node) === 'office:document-content')
  if (content === undefined) throw new NotAnOdpError('content.xml is not an OpenDocument body')

  const presentation = findDescendant(content, 'office:presentation')
  if (presentation === undefined) {
    throw new NotAnOdpError('not a presentation: this is some other OpenDocument')
  }

  const stylesText = pkg.parts.get('styles.xml')?.text
  const size = stylesText === undefined ? null : sizeOf(stylesText)

  const pages: OdpPage[] = []
  let skipped = 0

  for (const page of children(presentation).filter((node) => tagName(node) === 'draw:page')) {
    const read = shapesOf(page, pictures)
    skipped += read.skipped
    pages.push({ name: attribute(page, 'draw:name') ?? null, shapes: read.shapes })
  }

  return { size, pages, skipped }
}
