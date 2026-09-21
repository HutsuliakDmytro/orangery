import { contentTypeOf, writePackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import type { TextParagraph } from '@orangery/ooxml-drawingml'
import { flatten, relationshipTarget } from '@orangery/ooxml-presentation'
import type { Deck, Shape } from '@orangery/ooxml-presentation'
import { emuToLength } from './lengths'
import { ODP_MIME_TYPE } from './odp-read'

/**
 * Writing a deck out as an OpenDocument Presentation.
 *
 * A conversion in the same sense as the reader: what a slide says, laid out
 * where it says it, in the elements Impress expects. Nothing claims to survive
 * a trip out and back — the native format is PPTX, and saving to ODP is for
 * handing the deck to somebody who asked for one.
 *
 * What cannot be written is counted rather than dropped in silence.
 */

const NAMESPACES = Object.entries({
  'xmlns:office': 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  'xmlns:text': 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  'xmlns:style': 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  'xmlns:draw': 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  'xmlns:presentation': 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  'xmlns:fo': 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  'xmlns:svg': 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  'xmlns:xlink': 'http://www.w3.org/1999/xlink',
})
  .map(([name, value]) => `${name}="${value}"`)
  .join(' ')

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'

function escapeXml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/**
 * A paragraph, nested as deep as its outline level.
 *
 * PresentationML states the level as a number; OpenDocument expresses it by
 * putting the paragraph inside that many lists. Neither is more correct, and
 * the conversion is the only place that has to know both.
 */
function paragraph(text: string, level: number): string {
  let out = `<text:p>${escapeXml(text)}</text:p>`
  for (let depth = 0; depth < level; depth += 1) {
    out = `<text:list><text:list-item>${out}</text:list-item></text:list>`
  }
  return out
}

/** What a paragraph says, which is its runs put back together. */
function runsOf(paragraph: TextParagraph): string {
  return paragraph.runs.map((run) => (run.kind === 'break' ? '\n' : run.text)).join('')
}

function framePosition(shape: Shape): string | null {
  const transform = shape.transform
  if (transform === null) return null

  return [
    `svg:x="${emuToLength(transform.x)}"`,
    `svg:y="${emuToLength(transform.y)}"`,
    `svg:width="${emuToLength(Math.abs(transform.width))}"`,
    `svg:height="${emuToLength(Math.abs(transform.height))}"`,
  ].join(' ')
}

interface Written {
  content: string
  /** Pictures to carry across, by the name they will have in the package. */
  pictures: Map<string, Uint8Array>
  skipped: number
}

function writeShapes(pkg: OoxmlPackage, part: string, shapes: readonly Shape[]): Written {
  const pictures = new Map<string, Uint8Array>()
  let content = ''
  let skipped = 0

  for (const shape of flatten(shapes)) {
    const position = framePosition(shape)

    // A shape with no transform of its own inherits one from a placeholder, and
    // resolving that here would mean resolving inheritance in the converter.
    // Counted instead; it is a fact about the deck, not a failure to hide.
    if (position === null) {
      if (shape.text !== null || shape.picture !== null) skipped += 1
      continue
    }

    const embed = shape.picture?.relationshipId
    if (embed != null) {
      const target = relationshipTarget(pkg, part, embed)
      const media = target === null ? undefined : pkg.parts.get(target)
      if (target === null || media === undefined) {
        skipped += 1
        continue
      }

      const name = `Pictures/${target.split('/').pop() ?? 'image'}`
      pictures.set(name, media.bytes)
      content += `<draw:frame draw:layer="layout" ${position}><draw:image xlink:href="${name}"/></draw:frame>`
      continue
    }

    if (shape.text === null) {
      // Geometry: a rectangle, an arrow, a connector. Writing it would mean
      // translating two hundred preset paths into OpenDocument's own, which is
      // a project rather than a line.
      skipped += 1
      continue
    }

    const body = shape.text.paragraphs
      .map((one) => paragraph(runsOf(one), one.properties.level))
      .join('')

    content += `<draw:frame draw:layer="layout" ${position}><draw:text-box>${body}</draw:text-box></draw:frame>`
  }

  return { content, pictures, skipped }
}

function manifest(paths: readonly string[], pkg: OoxmlPackage): string {
  const entries = paths
    .map((path) => {
      const type = contentTypeOf(pkg, path) ?? contentTypeFor(path) ?? 'application/octet-stream'
      return `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${type}"/>`
    })
    .join('')

  return `${DECLARATION}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODP_MIME_TYPE}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${entries}</manifest:manifest>`
}

export interface WrittenOdp {
  bytes: Uint8Array
  /** What the deck had and the ODP does not. */
  skipped: number
}

export async function writeOdp(pkg: OoxmlPackage, deck: Deck): Promise<WrittenOdp> {
  const pictures = new Map<string, Uint8Array>()
  let pages = ''
  let skipped = 0

  for (const [index, slide] of deck.slides.entries()) {
    const written = writeShapes(pkg, slide.path, slide.shapes)
    skipped += written.skipped
    for (const [name, bytes] of written.pictures) pictures.set(name, bytes)

    pages += `<draw:page draw:name="page${String(index + 1)}" draw:master-page-name="Default">${written.content}</draw:page>`
  }

  const content = `${DECLARATION}<office:document-content ${NAMESPACES} office:version="1.3"><office:automatic-styles/><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`

  const styles = `${DECLARATION}<office:document-styles ${NAMESPACES} office:version="1.3"><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${emuToLength(deck.slideSize.width)}" fo:page-height="${emuToLength(deck.slideSize.height)}" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`

  const out: OoxmlPackage = { parts: new Map() }
  const encoder = new TextEncoder()
  const add = (path: string, bytes: Uint8Array, text?: string) => {
    out.parts.set(path, { path, bytes, ...(text === undefined ? {} : { text }), date: new Date() })
  }

  // `mimetype` first, and stored rather than deflated: that is what lets a
  // reader identify the file from its first bytes without unzipping it.
  add('mimetype', encoder.encode(ODP_MIME_TYPE))
  add('content.xml', encoder.encode(content), content)
  add('styles.xml', encoder.encode(styles), styles)
  for (const [name, bytes] of pictures) add(name, bytes)

  const listing = manifest([...pictures.keys()], pkg)
  add('META-INF/manifest.xml', encoder.encode(listing), listing)

  return { bytes: await writePackage(out, { stored: ['mimetype'] }), skipped }
}
