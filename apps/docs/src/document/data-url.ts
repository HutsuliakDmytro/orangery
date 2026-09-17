import { contentTypeFor } from '@orangery/ooxml-drawingml'

/**
 * Pictures as data URLs.
 *
 * The webview needs something it can put in a `src`, and a document being
 * converted carries its pictures this way and no other — so both directions of
 * the conversion live here, away from either package format.
 */

const DATA_URL = /^data:([a-z0-9.+/-]+);base64,(.*)$/isu

/** Bytes and an extension for a data URL, or null when it is not one. */
export function decodeDataUrl(src: string): { bytes: Uint8Array; extension: string } | null {
  const match = DATA_URL.exec(src.trim())
  if (match?.[1] === undefined || match[2] === undefined) return null

  const subtype = match[1].split('/')[1]?.toLowerCase()
  if (subtype === undefined || subtype === '') return null

  let binary: string
  try {
    binary = atob(match[2])
  } catch {
    // A truncated or mistyped data URL; the picture is reported, not written.
    return null
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  return { bytes, extension: extensionFor(subtype) }
}

/** The extension a document file stores that kind of picture under. */
export function extensionFor(subtype: string): string {
  // `image/jpeg` is stored as `.jpg`, which is what Word writes and what
  // `contentTypeFor` maps back.
  if (subtype === 'jpeg') return 'jpg'
  if (subtype === 'svg+xml') return 'svg'
  return subtype
}

/** A data URL for picture bytes, or null when no document format can hold them. */
export function dataUrlFrom(bytes: Uint8Array, fileName: string): string | null {
  const contentType = contentTypeFor(fileName)
  if (contentType === null) return null

  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${contentType};base64,${btoa(binary)}`
}
