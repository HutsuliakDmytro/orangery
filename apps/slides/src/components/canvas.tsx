import {
  absoluteTransform,
  connectorEnds,
  createShape,
  flatten,
  intoGroupSpace,
  moveConnectorEnd,
  writeCrop,
  withAncestors,
  writeTransform,
} from '@orangery/ooxml-presentation'
import { writeTextBody } from '@orangery/ooxml-drawingml'
import type { Transform } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'
import { applyDrag, applyRotation } from '../render/use-drag'
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
  const drawing = useViewStore((state) => state.drawing)
  const setDrawing = useViewStore((state) => state.setDrawing)
  const cells = useDeckStore((state) => state.cells)
  const pickCell = useDeckStore((state) => state.pickCell)
  const cropping = useDeckStore((state) => state.cropping)
  const setCropping = useDeckStore((state) => state.setCropping)
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
          drawing={drawing}
          onDraw={(box) => {
            const made: { id: number | null } = { id: null }
            edit((slide) => {
              made.id = createShape(slide, { preset: drawing ?? 'rect', transform: box })
              return true
            })

            // Disarmed after one shape, as PowerPoint does: drawing five
            // rectangles is five choices, and a tool that stayed armed would
            // turn every later click on the slide into a sixth.
            setDrawing(null)
            if (made.id !== null) selectShapes([made.id])
          }}
          editing={editing}
          onEdit={setEditing}
          onCommitText={(id, doc) => {
            edit((edited) => {
              const shape = edited.shapes.find((one) => one.id === id)
              return shape?.text == null ? false : writeTextBody(shape.text.node, doc)
            })
          }}
          cropping={cropping}
          onCrop={setCropping}
          cells={cells}
          onPickCell={pickCell}
          onDrag={(drag, correction) => {
            const selected = useDeckStore.getState().selection

            // While cropping, a handle takes a side away rather than resizing
            // the frame: the picture stays where it is and less of it shows.
            const side = drag.handle
            if (cropping !== null && side !== null && side !== 'rotate') {
              edit((edited) => {
                const picture = flatten(edited.shapes).find((one) => one.id === cropping)
                const box = picture?.transform
                if (picture?.picture == null || box == null) return false

                const crop = picture.picture.crop
                const across = box.width === 0 ? 0 : drag.dx / box.width
                const down = box.height === 0 ? 0 : drag.dy / box.height
                const clamp = (value: number) => Math.min(Math.max(value, 0), 0.9)

                return writeCrop(picture, {
                  left: side.includes('w') ? clamp(crop.left + across) : crop.left,
                  right: side.includes('e') ? clamp(crop.right - across) : crop.right,
                  top: side.includes('n') ? clamp(crop.top + down) : crop.top,
                  bottom: side.includes('s') ? clamp(crop.bottom - down) : crop.bottom,
                })
              })
              return
            }
            edit((edited) =>
              withAncestors(edited.shapes)
                .flatMap(({ shape, ancestors }) => {
                  const transform: Transform | null = shape.transform
                  if (!selected.includes(shape.id) || transform === null) return []

                  // A shape inside a group is written in that group's
                  // coordinates, and the drag was measured on the slide. Writing
                  // one as the other moves a shape in a scaled group by the
                  // wrong amount, and the more the group was resized the wronger.
                  if (drag.handle === 'cxn-start' || drag.handle === 'cxn-end') {
                    const box = absoluteTransform(transform, ancestors)
                    if (box === null) return []

                    const which = drag.handle === 'cxn-start' ? 'start' : 'end'
                    const at = connectorEnds(box)[which]
                    const point = { x: at.x + drag.dx, y: at.y + drag.dy }

                    // Whatever is under the end when it is let go, other than
                    // the connector itself: a line attached to itself is not a
                    // thing, and letting go over nothing means letting go.
                    const onto = flatten(edited.shapes).find(
                      (one) =>
                        one.id !== shape.id &&
                        one.kind !== 'cxnSp' &&
                        one.transform !== null &&
                        point.x >= one.transform.x &&
                        point.y >= one.transform.y &&
                        point.x <= one.transform.x + one.transform.width &&
                        point.y <= one.transform.y + one.transform.height,
                    )

                    return [moveConnectorEnd(shape, which, { point, onto: onto ?? null })]
                  }

                  if (drag.handle === 'rotate') {
                    // The angle is measured on the slide, so the box it is
                    // measured against has to be where the shape sits there.
                    const box = absoluteTransform(transform, ancestors)
                    if (box === null) return []
                    return [
                      writeTransform(shape, {
                        ...transform,
                        rotation: applyRotation(transform, box, drag),
                      }),
                    ]
                  }

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
