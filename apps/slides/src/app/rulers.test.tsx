import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { readGuides } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/** Rulers down two sides of the slide, and the guides dragged out of them. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const SLIDE = { width: 9144000, height: 6858000 }
const BOX = { width: 914.4, height: 685.8 }

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** jsdom lays nothing out, so the frame is given a rectangle to measure by. */
function measure() {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: BOX.width,
      height: BOX.height,
      right: BOX.width,
      bottom: BOX.height,
      toJSON: () => ({}),
    }),
  })
}

const guides = () => readGuides(useDeckStore.getState().open?.package ?? { parts: new Map() })

const showRulers = () => {
  act(() => {
    runCommand('view.rulers', {})
  })
}

/** Pixels for an EMU position on the slide. */
const px = (emu: number, axis: 'x' | 'y') =>
  axis === 'x' ? (emu / SLIDE.width) * BOX.width : (emu / SLIDE.height) * BOX.height

beforeEach(() => {
  measure()
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
  useViewStore.setState({ rulers: false, zoom: null, leftPane: 'filmstrip' })
})

describe('the rulers', () => {
  it('are off until they are asked for', async () => {
    await openDeck('shapes')
    render(<App />)

    expect(screen.queryByLabelText('Horizontal ruler')).toBeNull()
  })

  it('show both of them', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    expect(screen.getByLabelText('Horizontal ruler')).toBeInTheDocument()
    expect(screen.getByLabelText('Vertical ruler')).toBeInTheDocument()
  })

  it('bring the guides the deck was left with', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    // PowerPoint's own two, on the middle of the slide.
    expect(screen.getAllByLabelText(/guide$/u)).toHaveLength(2)
  })
})

describe('dragging a guide out of a ruler', () => {
  it('makes one where it was dropped', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    const before = guides().length
    fireEvent.pointerDown(screen.getByLabelText('Horizontal ruler'), {
      clientX: px(2_000_000, 'x'),
      clientY: 0,
    })
    fireEvent.pointerUp(window, { clientX: px(2_000_000, 'x'), clientY: 0 })

    const added = guides().filter((guide) => guide.orientation === 'vert')
    expect(guides()).toHaveLength(before + 1)
    expect(added.some((guide) => Math.abs(guide.at - 2_000_000) < 2000)).toBe(true)
  })

  it('makes a horizontal one from the side ruler', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    fireEvent.pointerDown(screen.getByLabelText('Vertical ruler'), {
      clientX: 0,
      clientY: px(1_000_000, 'y'),
    })
    fireEvent.pointerUp(window, { clientX: 0, clientY: px(1_000_000, 'y') })

    expect(
      guides().some(
        (guide) => guide.orientation === 'horz' && Math.abs(guide.at - 1_000_000) < 2000,
      ),
    ).toBe(true)
  })

  it('makes nothing when it is let go off the slide', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    const before = guides().length
    fireEvent.pointerDown(screen.getByLabelText('Horizontal ruler'), { clientX: 10, clientY: 0 })
    fireEvent.pointerUp(window, { clientX: -50, clientY: 0 })

    expect(guides()).toHaveLength(before)
  })
})

describe('moving and throwing away a guide', () => {
  it('moves the one that was picked up', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    const [first] = screen.getAllByLabelText('Horizontal guide')
    if (first === undefined) throw new Error('no guide to drag')

    fireEvent.pointerDown(first, { clientX: 0, clientY: px(3_000_000, 'y') })
    fireEvent.pointerUp(window, { clientX: 0, clientY: px(3_000_000, 'y') })

    expect(
      guides().some(
        (guide) => guide.orientation === 'horz' && Math.abs(guide.at - 3_000_000) < 2000,
      ),
    ).toBe(true)
  })

  it('throws it away when it is dragged off the slide', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    const [first] = screen.getAllByLabelText('Horizontal guide')
    if (first === undefined) throw new Error('no guide to drag')

    fireEvent.pointerDown(first, { clientX: 0, clientY: 10 })
    fireEvent.pointerUp(window, { clientX: 0, clientY: -80 })

    expect(guides().every((guide) => guide.orientation !== 'horz')).toBe(true)
  })

  it('is one undo step, and the slides never move', async () => {
    await openDeck('shapes')
    render(<App />)
    showRulers()

    const before = guides()
    fireEvent.pointerDown(screen.getByLabelText('Horizontal ruler'), {
      clientX: px(2_000_000, 'x'),
      clientY: 0,
    })
    fireEvent.pointerUp(window, { clientX: px(2_000_000, 'x'), clientY: 0 })

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(guides()).toEqual(before)
  })
})
