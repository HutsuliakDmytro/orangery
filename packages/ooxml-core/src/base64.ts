/**
 * Bytes as text, for the places only text will do.
 *
 * A clipboard entry, an autosave snapshot, a data URL: all of them are strings
 * and all of them may have to carry a package. Written in chunks because
 * `String.fromCharCode(...bytes)` on a megabyte is a million arguments, which
 * is a stack overflow rather than a slow call.
 */

const CHUNK = 8192

export function encodeBytes(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let at = 0; at < bytes.length; at += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + CHUNK)))
  }

  return btoa(chunks.join(''))
}

/** The bytes back, or null for something that was never this. */
export function decodeBytes(text: string): Uint8Array | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }

  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}
