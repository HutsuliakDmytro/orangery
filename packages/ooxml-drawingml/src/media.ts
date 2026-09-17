/**
 * Media parts referenced by a drawing.
 *
 * A picture is a relationship id pointing at a part under `word/media/` or
 * `ppt/media/`; the package needs its content type declared, and the only thing
 * to derive one from is the file name.
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
