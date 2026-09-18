import { writeTextBody } from '@orangery/ooxml-drawingml'
import { textBodyToDoc, textOfBody } from '@orangery/ooxml-drawingml'
import type { PmNode } from '@orangery/ooxml-drawingml'
import type { Shape, Slide } from '@orangery/ooxml-presentation'
import { TextEditor } from '../render/text-editor'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * The deck as text: every slide's title and the words under it.
 *
 * It shows placeholders and nothing else. A shape a person drew is at a place
 * on a slide and means something by being there; a placeholder is the slide
 * saying "this is the title" and "this is the body", which is exactly what an
 * outline is a list of. Free text boxes are left out rather than guessed at.
 *
 * Editing is the same ProseMirror bridge the canvas uses, so a title typed here
 * keeps the run formatting it had — the outline is another way into the same
 * text, not a plainer copy of it.
 */

const TITLES = new Set(['title', 'ctrTitle'])

/** The title of a slide, and the placeholders that hold its body text. */
function outlineOf(slide: Slide): { title: Shape | null; bodies: Shape[] } {
  const title = slide.shapes.find((shape) => TITLES.has(shape.placeholder?.type ?? '')) ?? null

  const bodies = slide.shapes.filter(
    (shape) =>
      shape !== title &&
      shape.placeholder !== null &&
      shape.text != null &&
      !['dt', 'ftr', 'sldNum'].includes(shape.placeholder.type),
  )

  return { title, bodies }
}

export function Outline() {
  const open = useDeckStore((state) => state.open)
  const current = useDeckStore((state) => state.current)
  const select = useDeckStore((state) => state.select)
  const setEditing = useDeckStore((state) => state.setEditing)
  const edit = useDeckStore((state) => state.edit)

  const editing = useViewStore((state) => state.editingOutline)
  const setEditingOutline = useViewStore((state) => state.setEditingOutline)

  if (open === null) {
    return <p className="p-2 text-xs text-muted">No presentation open</p>
  }

  const commit = (id: number, doc: PmNode) => {
    edit((slide) => {
      const shape = slide.shapes.find((one) => one.id === id)
      return shape?.text == null ? false : writeTextBody(shape.text.node, doc)
    })
    setEditingOutline(null)
  }

  const line = (shape: Shape, index: number, heading: boolean) => {
    if (shape.text == null) return null
    const text = textOfBody(shape.text)

    if (editing?.slide === index && editing.shape === shape.id) {
      return (
        <div key={shape.id} className={heading ? 'font-medium text-text' : 'pl-4 text-text'}>
          <TextEditor
            doc={textBodyToDoc(shape.text)}
            onCommit={(doc) => {
              commit(shape.id, doc)
            }}
            onCancel={() => {
              setEditingOutline(null)
            }}
          />
        </div>
      )
    }

    return (
      <button
        key={shape.id}
        type="button"
        aria-label={`${heading ? 'Title' : 'Body'} of slide ${String(index + 1)}`}
        onClick={() => {
          select(index)
          // Only one text edit at a time: entering one here ends whatever the
          // canvas had open.
          setEditing(null)
          setEditingOutline({ slide: index, shape: shape.id })
        }}
        className={`w-full cursor-text text-left ${
          heading ? 'font-medium text-text' : 'pl-4 text-muted'
        }`}
      >
        {text === '' ? <span className="text-muted">Empty</span> : text}
      </button>
    )
  }

  return (
    <ol className="space-y-3 p-2 text-xs">
      {open.deck.slides.map((slide, index) => {
        const { title, bodies } = outlineOf(slide)

        return (
          <li
            key={slide.path}
            className={index === current ? 'border-l-2 border-accent pl-2' : 'pl-2'}
          >
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-[10px] text-muted">{index + 1}</span>
              <div className="min-w-0 flex-1">
                {title === null ? (
                  <span className="text-muted">Untitled slide</span>
                ) : (
                  line(title, index, true)
                )}
              </div>
            </div>
            {bodies.map((shape) => line(shape, index, false))}
          </li>
        )
      })}
    </ol>
  )
}
