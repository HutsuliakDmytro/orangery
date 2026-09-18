import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Dragging a shape onto the lines the slide already offers.
 *
 * jsdom lays nothing out, so the canvas is given a rectangle to measure itself
 * by: the drag converts pixels to EMU through it, and without one every drag
 * would be a drag of nothing.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const SLIDE = { width: 9144000, height: 6858000 }
const CANVAS = { width: 914.4, height: 685.8 }

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** Ten thousand EMU to the pixel, so a pixel of slop is a round number. */
function measureCanvas() {
  Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      width: CANVAS.width,
      height: CANVAS.height,
      top: 0,
      left: 0,
      right: CANVAS.width,
      bottom: CANVAS.height,
      toJSON: () => ({}),
    }),
  })
}

const shapes = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

const transformOf = (index: number) => shapes()[index]?.transform ?? null

/** Drags the shape at `index` by a distance in EMU. */
function dragShape(index: number, dx: number, dy: number) {
  const shape = shapes()[index]
  if (shape === undefined) throw new Error('no such shape')

  act(() => {
    useDeckStore.getState().selectShapes([shape.id])
  })

  const target = screen.getAllByRole('button', { name: shape.name })[0]
  if (target === undefined) throw new Error('the shape is not on the canvas')

  const perPixel = SLIDE.width / CANVAS.width
  fireEvent.pointerDown(target, { clientX: 0, clientY: 0 })
  fireEvent.pointerMove(window, { clientX: dx / perPixel, clientY: dy / perPixel })
  fireEvent.pointerUp(window, { clientX: dx / perPixel, clientY: dy / perPixel })
}

beforeEach(() => {
  measureCanvas()
  useDeckStore.setState({
    open: null,
    current: -1,
    master: null,
    selection: [],
    slideSelection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
  useViewStore.setState({ leftPane: 'filmstrip', zoom: null })
})

describe('dragging a shape', () => {
  it('moves it by the distance dragged when nothing is near', async () => {
    await openDeck('shapes')
    render(<App />)

    const before = transformOf(0)
    dragShape(0, 1_000_000, 500_000)

    expect(transformOf(0)?.x).toBe((before?.x ?? 0) + 1_000_000)
    expect(transformOf(0)?.y).toBe((before?.y ?? 0) + 500_000)
  })

  it('is taken onto the middle of the slide when it comes close', async () => {
    await openDeck('shapes')
    render(<App />)

    const before = transformOf(0)
    if (before === null) throw new Error('fixture changed')

    // Aim the centre of the shape a hair off the middle of the slide.
    const wanted = SLIDE.width / 2 - before.width / 2
    dragShape(0, wanted - before.x + 20_000, 0)

    expect(transformOf(0)?.x).toBe(wanted)
  })

  it('writes what the guide promised, not what the pointer said', async () => {
    // A shape that snapped on screen and not in the file is the worst of both.
    await openDeck('shapes')
    render(<App />)

    const first = transformOf(0)
    const second = transformOf(1)
    if (first === null || second === null) throw new Error('fixture changed')

    dragShape(1, first.x - second.x + 15_000, 0)

    expect(transformOf(1)?.x).toBe(first.x)
  })

  it('leaves the shapes that were not selected alone', async () => {
    await openDeck('shapes')
    render(<App />)

    const other = transformOf(1)
    dragShape(0, 1_000_000, 0)

    expect(transformOf(1)).toEqual(other)
  })

  it('is one undo step', async () => {
    await openDeck('shapes')
    render(<App />)

    const before = transformOf(0)
    dragShape(0, 1_000_000, 0)
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(transformOf(0)).toEqual(before)
  })
})

describe('the guides themselves', () => {
  it('are drawn while a shape is in line with something', async () => {
    await openDeck('shapes')
    render(<App />)

    const shape = shapes()[0]
    const where = shape?.transform ?? null
    if (shape === undefined || where === null) throw new Error('fixture changed')

    act(() => {
      useDeckStore.getState().selectShapes([shape.id])
    })

    const target = screen.getAllByRole('button', { name: shape.name })[0]
    if (target === undefined) throw new Error('the shape is not on the canvas')

    const perPixel = SLIDE.width / CANVAS.width
    const wanted = SLIDE.width / 2 - where.width / 2
    fireEvent.pointerDown(target, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, {
      clientX: (wanted - where.x + 20_000) / perPixel,
      clientY: 0,
    })

    expect(screen.getAllByTestId('guides').length).toBeGreaterThan(0)

    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 })
  })

  it('are gone once the drag is over', async () => {
    await openDeck('shapes')
    render(<App />)

    dragShape(0, 1_000_000, 0)

    expect(screen.queryByTestId('guides')).toBeNull()
  })
})
