import { readSlidePart } from '@orangery/ooxml-presentation'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * The speaker notes of the slide being shown.
 *
 * A notes page is its own part with its own shape tree, and the notes live in
 * the placeholder of type `body` on it — the other placeholder is a picture of
 * the slide, which is not worth showing twice.
 */
export function Notes() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)

  if (open === null || slide === null || slide.notes === null) {
    return <p className="text-xs text-muted">No notes on this slide</p>
  }

  const part = readSlidePart(open.package, slide.notes)
  const body = part?.shapes.find((shape) => shape.placeholder?.type === 'body')
  const text = body?.text == null ? '' : textOfBody(body.text)

  return text === '' ? (
    <p className="text-xs text-muted">No notes on this slide</p>
  ) : (
    <p className="whitespace-pre-wrap text-xs text-text">{text}</p>
  )
}
