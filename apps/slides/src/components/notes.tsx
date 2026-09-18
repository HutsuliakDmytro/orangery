import { useMemo } from 'react'
import { readSlidePart, writePart } from '@orangery/ooxml-presentation'
import { textBodyToDoc, textOfBody, writeTextBody } from '@orangery/ooxml-drawingml'
import type { PmNode } from '@orangery/ooxml-drawingml'
import { TextEditor } from '../render/text-editor'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * The speaker notes of the slide being shown.
 *
 * A notes page is its own part with its own shape tree, and the notes live in
 * the placeholder of type `body` on it — the other placeholder is a picture of
 * the slide, which is not worth showing twice.
 *
 * Edited through the same ProseMirror bridge the slide uses rather than a plain
 * text box: notes carry formatting like any other text, and flattening them to
 * a string would lose it the first time anyone opened the panel.
 */
export function Notes() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const editPackage = useDeckStore((state) => state.editPackage)
  const editing = useViewStore((state) => state.editingNotes)
  const setEditing = useViewStore((state) => state.setEditingNotes)

  const notes = useMemo(() => {
    if (open === null || slide?.notes == null) return null

    const part = readSlidePart(open.package, slide.notes)
    const body = part?.shapes.find((shape) => shape.placeholder?.type === 'body')
    const text = body?.text
    return part === null || text == null ? null : { part, text }
  }, [open, slide])

  if (open === null || slide === null) {
    return <p className="text-xs text-muted">No presentation</p>
  }

  if (notes === null) {
    // A slide with no notes page has nowhere to put them; making one is its own
    // operation, and pretending otherwise would lose what was typed.
    return <p className="text-xs text-muted">This slide has no notes page</p>
  }

  const text = textOfBody(notes.text)

  const commit = (doc: PmNode) => {
    editPackage((deck) => {
      const part = readSlidePart(deck.package, slide.notes ?? '')
      const body = part?.shapes.find((shape) => shape.placeholder?.type === 'body')
      if (part == null || body?.text == null) return false

      writeTextBody(body.text.node, doc)
      writePart(deck.package, part.path, part.root)
      return true
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="text-xs text-text">
        <TextEditor
          doc={textBodyToDoc(notes.text)}
          onCommit={commit}
          onCancel={() => {
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      aria-label="Edit speaker notes"
      onClick={() => {
        setEditing(true)
      }}
      className="w-full cursor-text text-left text-xs"
    >
      {text === '' ? (
        <span className="text-muted">Click to add notes</span>
      ) : (
        <span className="whitespace-pre-wrap text-text">{text}</span>
      )}
    </button>
  )
}
