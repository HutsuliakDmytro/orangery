/**
 * Bytes as text.
 *
 * Needed wherever bytes have to travel through something that only carries
 * strings: a data URL in the renderer, a JSON snapshot on disk. One
 * implementation rather than one per caller, because the chunking below is the
 * kind of detail that gets left out of the second copy.
 */

/** Well under the argument limit of `String.fromCharCode` on every engine. */
const CHUNK = 8192

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: spreading a megabyte of bytes into String.fromCharCode overflows
  // the argument limit.
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
