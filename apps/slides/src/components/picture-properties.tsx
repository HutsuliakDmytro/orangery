import { addMedia } from '@orangery/ooxml-core'
import {
  flatten,
  relsPartFor,
  replacePicture,
  writeCrop,
  writePictureOpacity,
} from '@orangery/ooxml-presentation'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import { nameOf, pickPicturePath, readFileBytes } from '../document/file'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * What can be done to a picture that cannot be done to a shape.
 *
 * Transparency, swapping the file underneath, and putting both back. Cropping
 * is not here: it is a thing done on the slide with the pointer, and a number
 * in a panel would be a second way to do it that disagreed with the first.
 */

const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/** What a picture can be made, short of invisible. */
const OPACITIES = [
  ['Solid', 1],
  ['75%', 0.75],
  ['50%', 0.5],
  ['25%', 0.25],
] as const

export function PictureProperties() {
  const selection = useDeckStore((state) => state.selection)
  const slide = useDeckStore(currentSlide)
  const open = useDeckStore((state) => state.open)
  const edit = useDeckStore((state) => state.edit)

  const picture =
    slide === null
      ? undefined
      : flatten(slide.shapes).find(
          (shape) => selection.includes(shape.id) && shape.picture !== null,
        )

  if (open === null || picture?.picture == null) return null

  const apply = (change: (shape: NonNullable<typeof picture>) => boolean) => {
    edit((edited) => {
      const here = flatten(edited.shapes).find((shape) => shape.id === picture.id)
      return here === undefined ? false : change(here)
    })
  }

  const replace = () => {
    void (async () => {
      const path = await pickPicturePath()
      if (path === null || slide === null) return

      const contentType = contentTypeFor(path)
      if (contentType === null) return

      const bytes = await readFileBytes(path)
      apply((shape) => {
        const media = addMedia(open.package, {
          directory: 'ppt/media',
          relsPart: relsPartFor(slide.path),
          relationshipType: IMAGE_RELATIONSHIP,
          fileName: nameOf(path),
          bytes,
          contentType,
        })
        return replacePicture(shape, media.relationshipId)
      })
    })()
  }

  return (
    <section aria-label="Picture" className="space-y-2">
      <h2 className="uppercase tracking-wide text-muted">Picture</h2>

      <div className="flex flex-wrap gap-1">
        {OPACITIES.map(([label, value]) => (
          <button
            key={label}
            type="button"
            aria-label={`Opacity ${label.toLowerCase()}`}
            aria-pressed={Math.abs((picture.picture?.opacity ?? 1) - value) < 0.01}
            onClick={() => {
              apply((shape) => writePictureOpacity(shape, value))
            }}
            className="rounded border border-border px-1.5 py-0.5 text-muted"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={replace}
          className="rounded border border-border px-1.5 py-0.5 text-muted"
        >
          Replace…
        </button>
        <button
          type="button"
          aria-label="Reset picture"
          onClick={() => {
            // The crop and the transparency, and nothing else: the frame is
            // where somebody put it, and resetting that would be undoing a
            // different decision than the one they asked to undo.
            apply((shape) => {
              const cleared = writeCrop(shape, { left: 0, top: 0, right: 0, bottom: 0 })
              return writePictureOpacity(shape, 1) || cleared
            })
          }}
          className="rounded border border-border px-1.5 py-0.5 text-muted"
        >
          Reset
        </button>
      </div>
    </section>
  )
}
