/**
 * Media parts referenced by a drawing.
 *
 * A picture is a relationship id pointing at a part under `word/media/` or
 * `ppt/media/`; the package needs its content type declared, and the only thing
 * to derive one from is the file name.
 *
 * Showing one is the other half of the same question: a webview wants
 * something it can put in a `src`, and the bytes in the package are not that
 * until they are wrapped in the content type this file works out.
 */

/** Content type for a media part, from its extension. */
export function contentTypeFor(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return null
  }
}

/**
 * Content type for a sound or a film, from its extension.
 *
 * Kept apart from the picture table on purpose: a place that asks "is this an
 * image" must not be told yes about an `.m4a` because both questions happen to
 * be "what is this file". A recorder writes whichever of these the engine it
 * runs on produces, and they differ by engine rather than by choice.
 */
export function mediaContentTypeFor(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'm4a':
      return 'audio/mp4'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
      return 'audio/ogg'
    case 'weba':
      return 'audio/webm'
    case 'mp4':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mov':
      return 'video/quicktime'
    default:
      return null
  }
}

/**
 * A data URL for picture bytes, or null when no drawing format can hold them.
 *
 * A data URL rather than a blob one: a blob URL has to be revoked by whoever
 * made it, and a picture drawn by a component that re-renders would leak one
 * per render or be revoked while still on screen. The cost is a third again
 * in size, held only while the picture is shown.
 */
export function dataUrlFrom(bytes: Uint8Array, fileName: string): string | null {
  const contentType = contentTypeFor(fileName)
  if (contentType === null) return null

  // Built in chunks: `String.fromCharCode(...bytes)` on a megabyte of image is
  // a million arguments, which is a stack overflow rather than a slow call.
  const chunks: string[] = []
  for (let at = 0; at < bytes.length; at += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
  }

  return `data:${contentType};base64,${btoa(chunks.join(''))}`
}
