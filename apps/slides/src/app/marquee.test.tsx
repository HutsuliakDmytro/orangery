import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flatten } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * The rubber band.
 *
 * jsdom lays nothing out, so the SVG has no rectangle of its own and every
 * pointer position would convert to zero. The rectangle is stood in for — the
 * question here is what the band catches, not what the browser measures, and
 * what it measures is covered by the drag machinery this shares.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

/** How wide the SVG pretends to be on screen. */
const DRAWN = 1219.2

/**
 * EMU per pixel for the deck that is open.
 *
 * Read from the deck rather than assumed: this fixture is a 4:3 slide, and a
 * test that assumed widescreen would convert every coordinate by a quarter too
 * much and blame the code for it.
 */
const scale = () => (useDeckStore.getState().open?.deck.slideSize.width ?? 0) / DRAWN

/** A point on the slide, as the pointer coordinates that would land on it. */
const client = (point: { x: number; y: number }) => ({
  clientX: point.x / scale(),
  clientY: point.y / scale(),
})

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: DRAWN,
    height: DRAWN,
    right: DRAWN,
    bottom: DRAWN,
    toJSON: () => ({}),
  })

  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })
})

/** Drags a band between two points given in EMU. */
function band(from: { x: number; y: number }, to: { x: number; y: number }) {
  const background = within(screen.getByTestId('canvas')).getByTestId('slide-background')

  fireEvent.pointerDown(background, client(from))
  fireEvent.pointerMove(window, client(to))
  fireEvent.pointerUp(window, client(to))
}

const topLevel = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

describe('dragging a band on the slide', () => {
  it('catches everything it encloses', () => {
    render(<App />)

    const slide = useDeckStore.getState().open?.deck.slideSize
    band({ x: 0, y: 0 }, { x: slide?.width ?? 0, y: slide?.height ?? 0 })

    expect(useDeckStore.getState().selection).toHaveLength(topLevel().length)
  })

  it('catches nothing when it encloses nothing', () => {
    render(<App />)

    // A band in a corner of an empty part of the slide.
    band({ x: 0, y: 0 }, { x: 1000, y: 1000 })

    expect(useDeckStore.getState().selection).toEqual([])
  })

  it('leaves a shape it only overlaps', () => {
    render(<App />)
    const first = flatten(topLevel())[0]
    const box = first?.transform
    if (box == null) throw new Error('fixture shape has no transform')

    // Stops halfway across it: touched, not enclosed.
    band(
      { x: box.x - 100, y: box.y - 100 },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )

    expect(useDeckStore.getState().selection).toEqual([])
  })

  it('shows the band while it is being dragged, and not after', () => {
    render(<App />)
    const background = within(screen.getByTestId('canvas')).getByTestId('slide-background')

    fireEvent.pointerDown(background, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 })
    expect(screen.getByTestId('marquee')).toBeInTheDocument()

    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 })
    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
  })

  it('clears the selection when it catches nothing, rather than keeping it', () => {
    render(<App />)
    act(() => {
      useDeckStore.getState().selectShapes([flatten(topLevel())[0]?.id ?? 0])
    })

    band({ x: 0, y: 0 }, { x: 1000, y: 1000 })

    expect(useDeckStore.getState().selection).toEqual([])
  })
})

describe('the handles around a selected shape', () => {
  const select = () => {
    act(() => {
      useDeckStore.getState().selectShapes([flatten(topLevel())[0]?.id ?? 0])
    })
  }

  const firstBox = () => {
    const box = flatten(topLevel())[0]?.transform
    if (box == null) throw new Error('fixture shape has no transform')
    return box
  }

  it('offers all eight, and one to turn it by', () => {
    render(<App />)
    select()

    for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(screen.getByRole('button', { name: `Resize ${corner}` })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument()
  })

  it('moves one edge and leaves the other three', () => {
    render(<App />)
    select()
    const before = firstBox()

    const handle = screen.getByRole('button', { name: 'Resize e' })
    fireEvent.pointerDown(handle, client({ x: before.x + before.width, y: before.y }))
    fireEvent.pointerMove(window, client({ x: before.x + before.width * 1.5, y: before.y + 1000 }))
    fireEvent.pointerUp(window, client({ x: before.x + before.width * 1.5, y: before.y + 1000 }))

    const after = firstBox()
    // Wider by roughly the drag: "roughly" because the edge snaps to whatever
    // it lined up with, which is the point of the guides and not of this test.
    expect(after.width).toBeGreaterThan(before.width)
    // Dragged down as well as across, and the height did not follow.
    expect(after.height).toBe(before.height)
    expect(after.y).toBe(before.y)
  })

  it('turns the shape without resizing it', () => {
    render(<App />)
    select()
    const before = firstBox()

    const handle = screen.getByRole('button', { name: 'Rotate' })
    // From above the centre round to the right of it: a quarter turn.
    const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
    const above = client({ x: centre.x, y: 0 })
    const right = client({ x: centre.x + before.width, y: centre.y })

    fireEvent.pointerDown(handle, above)
    fireEvent.pointerMove(window, right)
    fireEvent.pointerUp(window, right)

    const after = firstBox()
    // A quarter turn further round than it was: the fixture's shape is already
    // at an angle, and turning adds rather than sets.
    const quarter = 90 * 60000
    const full = 360 * 60000
    expect((after.rotation - before.rotation + full) % full).toBeCloseTo(quarter, -2)
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
  })
})
