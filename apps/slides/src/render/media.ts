import { relationshipTarget } from '@orangery/ooxml-presentation'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import { contentTypeOf } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Media as something an `<image>` can show.
 *
 * The bytes are already in memory — they came out of the zip — so a data URL
 * costs one base64 encode and no file system. A blob URL would be cheaper for a
 * large deck and would have to be revoked when the deck closes; that trade is
 * worth making when there is a deck big enough to notice.
 */

const cache = new WeakMap<OoxmlPackage, Map<string, string | null>>()

function encode(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: spreading a megabyte of bytes into String.fromCharCode overflows
  // the argument limit.
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(binary)
}

/** The image a relationship on a part points at, or null when there is none. */
export function mediaUrl(
  pkg: OoxmlPackage,
  part: string,
  relationshipId: string | null,
): string | null {
  if (relationshipId === null) return null

  const byPart = cache.get(pkg) ?? new Map<string, string | null>()
  cache.set(pkg, byPart)

  const key = `${part}#${relationshipId}`
  const known = byPart.get(key)
  if (known !== undefined) return known

  const target = relationshipTarget(pkg, part, relationshipId)
  const bytes = target === null ? undefined : pkg.parts.get(target)?.bytes

  // What the package declares, before what the extension suggests: a sound
  // written to a `.vid` file is exactly the case where guessing is wrong.
  const type = target === null ? null : (contentTypeOf(pkg, target) ?? contentTypeFor(target))

  const url = bytes === undefined || type === null ? null : `data:${type};base64,${encode(bytes)}`
  byPart.set(key, url)
  return url
}
