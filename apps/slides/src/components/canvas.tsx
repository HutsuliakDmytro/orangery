import { intoGroupSpace, withAncestors, writeTransform } from '@orangery/ooxml-presentation'
import { writeTextBody } from '@orangery/ooxml-drawingml'
import type { Transform } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'
import { applyDrag } from '../render/use-drag'
import { correct } from '../render/snap'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'
import { Guides } from './guides'
import { WelcomeScreen } from './welcome-screen'

/** The slide being edited, centred with room around it. */
export function Canvas() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const error = useDeckStore((state) => state.error)
  const selection = useDeckStore((state) => state.selection)
  const selectShapes = useDeckStore((state) => state.selectShapes)
  const edit = useDeckStore((state) => state.edit)
  const editing = useDeckStore((state) => state.editing)
  const zoom = useViewStore((state) => state.zoom)
  const rulers = useViewStore((state) => state.rulers)
  const setEditing = useDeckStore((state) => state.setEditing)
  const openGroup = useDeckStore((state) => state.openGroup)
  const setOpenGroup = useDeckStore((state) => state.setOpenGroup)

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p role="alert" className="max-w-md text-center text-sm text-danger">
          {error}
        </p>
      </div>
    )
  }

  if (open === null || slide === null) return <WelcomeScreen />

  return (
    <div data-testid="canvas" className="flex h-full items-center justify-center overflow-auto p-6">
      {/* At a set zoom the slide keeps that size and the canvas scrolls; fitted,
          it takes what the window gives it. */}
      <div
        className="relative"
        style={
          zoom === null
            ? { width: '100%', maxWidth: '56rem' }
            : { width: `${String(zoom * 56)}rem`, flexShrink: 0 }
        }
      >
        <SlideView
          deck={open.deck}
          slide={slide}
          themes={open.themes}
          package={open.package}
          selection={selection}
          onSelect={(id, extend) => {
            selectShapes(id === null ? [] : [id], extend && id !== null)
          }}
          openGroup={openGroup}
          onOpenGroup={setOpenGroup}
          onMarquee={(ids) => {
            selectShapes(ids)
          }}
          editing={editing}
          onEdit={setEditing}
          onCommitText={(id, doc) => {
            edit((edited) => {
              const shape = edited.shapes.find((one) => one.id === id)
              return shape?.text == null ? false : writeTextBody(shape.text.node, doc)
            })
          }}
          onDrag={(drag, correction) => {
            const selected = useDeckStore.getState().selection
            edit((edited) =>
              withAncestors(edited.shapes)
                .flatMap(({ shape, ancestors }) => {
                  const transform: Transform | null = shape.transform
                  if (!selected.includes(shape.id) || transform === null) return []

                  // A shape inside a group is written in that group's
                  // coordinates, and the drag was measured on the slide. Writing
                  // one as the other moves a shape in a scaled group by the
                  // wrong amount, and the more the group was resized the wronger.
                  const into = intoGroupSpace(ancestors)
                  const scaled = { ...drag, dx: drag.dx * into.x, dy: drag.dy * into.y }

                  // The same correction the guides were drawn from: a shape that
                  // snapped on screen and not in the file is the worst of both.
                  const moved = correct(applyDrag(transform, scaled), {
                    dx: correction.dx * into.x,
                    dy: correction.dy * into.y,
                    dw: correction.dw * into.x,
                    dh: correction.dh * into.y,
                  })
                  return [writeTransform(shape, { ...transform, ...moved })]
                })
                // Reduced rather than `some`, so every shape moves before the
                // answer is worked out.
                .reduce((changed: boolean, one) => changed || one, false),
            )
          }}
          className="shadow-lg"
          style={{ width: '100%' }}
        />
        {rulers && <Guides width={open.deck.slideSize.width} height={open.deck.slideSize.height} />}
      </div>
    </div>
  )
}
