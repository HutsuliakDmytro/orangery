import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ImageResizer } from '../../components/image-resizer'

/**
 * Images, extended with the OOXML attributes the document needs.
 *
 * Tiptap's image node knows `src`, `alt` and `title`. A DOCX image is identified
 * by a relationship id, sized in points, and carries the original drawing XML so
 * an untouched picture round-trips exactly — see `src/ooxml/image.ts`.
 */
export const DocumentImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      /** Relationship id into `word/_rels/document.xml.rels`. */
      relationshipId: { default: null },
      /** Display size in points, which is what OOXML stores. */
      width: {
        default: null,
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = attributes['width']
          return typeof width === 'number' ? { style: `width: ${String(width)}pt` } : {}
        },
      },
      height: { default: null },
      /** Original `w:drawing`, written back when the image was not resized. */
      /** `inline`, `left`, `right` or `topAndBottom` — see `src/ooxml/image.ts`. */
      wrap: { default: 'inline' },
      drawing: { default: null },
      drawingWidth: { default: null },
      drawingWrap: { default: null },
      imageId: { default: null },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageResizer)
  },
})
