import { addRelationship, parseRelationships, serializeRelationships } from './relationships'
import { CONTENT_TYPES_PART, getPartText, setPartText } from './package'
import type { OoxmlPackage } from './package'
import { attribute, buildXml, children, element, parseXml, tagName, withDeclaration } from './xml'
import type { XmlNode } from './xml'

/**
 * Adding a media file to an OOXML package.
 *
 * Three things have to change together, and a file with any one of them missing
 * makes Word or PowerPoint offer to repair it:
 *
 *   1. the bytes land under the format's media directory,
 *   2. a relationship points at them from the part that uses them,
 *   3. `[Content_Types].xml` says how to read that extension.
 *
 * Where those live differs per format — `word/media` against `ppt/media`, one
 * rels file against one per slide — so they are given rather than assumed.
 */

export interface AddedMedia {
  relationshipId: string
  /** Package path, e.g. `ppt/media/image3.png`. */
  path: string
}

/** Next free `imageN.ext` under a directory, so nothing is overwritten. */
export function nextMediaName(pkg: OoxmlPackage, directory: string, extension: string): string {
  const pattern = new RegExp(`^${directory}/image(\\d+)\\.`, 'u')
  let highest = 0

  for (const path of pkg.parts.keys()) {
    const match = pattern.exec(path)
    if (match?.[1] !== undefined) highest = Math.max(highest, Number.parseInt(match[1], 10))
  }

  return `image${String(highest + 1)}.${extension}`
}

/** Declares an extension in `[Content_Types].xml` if it is not there already. */
export function ensureContentType(pkg: OoxmlPackage, extension: string, contentType: string): void {
  const text = getPartText(pkg, CONTENT_TYPES_PART)
  if (text === undefined) return

  const roots = parseXml(text)
  const types = roots.find((node) => tagName(node) === 'Types')
  if (types === undefined) return

  const already = children(types).some(
    (node: XmlNode) =>
      tagName(node) === 'Default' &&
      attribute(node, 'Extension')?.toLowerCase() === extension.toLowerCase(),
  )
  if (already) return

  // Defaults come before overrides in every package Office writes; adding at
  // the front keeps that true without having to find the boundary.
  children(types).unshift(element('Default', { Extension: extension, ContentType: contentType }))
  setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(buildXml(roots)))
}

export interface MediaRequest {
  /** Where the bytes go, without a trailing slash: `ppt/media`. */
  directory: string
  /** The rels file of the part that will point at them. */
  relsPart: string
  /** The relationship type, usually the image one. */
  relationshipType: string
  /** Used for its extension, and to work out the content type. */
  fileName: string
  contentType: string
  bytes: Uint8Array
}

/**
 * Adds media to the package and returns the relationship that points at it.
 *
 * The relationship target is relative to the rels file's own directory, which
 * is how every other target in the package is written.
 */
export function addMedia(pkg: OoxmlPackage, request: MediaRequest): AddedMedia {
  const extension = request.fileName.split('.').pop()?.toLowerCase() ?? ''
  const name = nextMediaName(pkg, request.directory, extension)
  const path = `${request.directory}/${name}`

  pkg.parts.set(path, { path, bytes: request.bytes, date: new Date() })
  ensureContentType(pkg, extension, request.contentType)

  const relationships = parseRelationships(getPartText(pkg, request.relsPart) ?? '')
  const owner = request.relsPart.replace(/\/_rels\/[^/]+$/u, '')
  const target = relativeTo(owner, path)

  const relationship = addRelationship(relationships, request.relationshipType, target)
  setPartText(pkg, request.relsPart, serializeRelationships(relationships))

  return { relationshipId: relationship.id, path }
}

/** A package path written relative to a directory, as a relationship states it. */
function relativeTo(from: string, to: string): string {
  const fromParts = from.split('/').filter(Boolean)
  const toParts = to.split('/').filter(Boolean)

  let shared = 0
  while (shared < fromParts.length && fromParts[shared] === toParts[shared]) shared += 1

  const up = Array.from({ length: fromParts.length - shared }, () => '..')
  return [...up, ...toParts.slice(shared)].join('/')
}

/**
 * Declares a part in `[Content_Types].xml` by name.
 *
 * A `Default` covers every file with an extension; an `Override` names one
 * part. A new slide needs an override, because `.xml` already has a default
 * that says something else entirely.
 */
export function ensureOverride(pkg: OoxmlPackage, path: string, contentType: string): void {
  const text = getPartText(pkg, CONTENT_TYPES_PART)
  if (text === undefined) return

  const roots = parseXml(text)
  const types = roots.find((node) => tagName(node) === 'Types')
  if (types === undefined) return

  const name = `/${path}`
  const already = children(types).some(
    (node: XmlNode) => tagName(node) === 'Override' && attribute(node, 'PartName') === name,
  )
  if (already) return

  // Overrides come after the defaults, which is where appending puts it.
  children(types).push(element('Override', { PartName: name, ContentType: contentType }))
  setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(buildXml(roots)))
}
