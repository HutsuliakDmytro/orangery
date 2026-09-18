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

/** The slide is 12192000 EMU wide; pretend it is drawn 1219.2 px across. */
const SCALE = 10_000

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 12_192_000 / SCALE,
    height: 6_858_000 / SCALE,
    right: 12_192_000 / SCALE,
    bottom: 6_858_000 / SCALE,
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

  fireEvent.pointerDown(background, { clientX: from.x / SCALE, clientY: from.y / SCALE })
  fireEvent.pointerMove(window, { clientX: to.x / SCALE, clientY: to.y / SCALE })
  fireEvent.pointerUp(window, { clientX: to.x / SCALE, clientY: to.y / SCALE })
}

const topLevel = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

describe('dragging a band on the slide', () => {
  it('catches everything it encloses', () => {
    render(<App />)

    band({ x: 0, y: 0 }, { x: 12_192_000, y: 6_858_000 })

    expect(useDeckStore.getState().selection).toHaveLength(topLevel().length)
  })

  it('catches nothing when it encloses nothing', () => {
    render(<App />)

    // A band in a corner of an empty part of the slide.
    band({ x: 0, y: 0 }, { x: 10_000, y: 10_000 })

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

    band({ x: 0, y: 0 }, { x: 10_000, y: 10_000 })

    expect(useDeckStore.getState().selection).toEqual([])
  })
})
