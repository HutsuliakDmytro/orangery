import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { isKnownPreset } from '../render/geometry'
import { SHAPE_GROUPS } from '../render/shape-presets'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Choosing a shape, then drawing it out.
 *
 * The SVG has no rectangle in jsdom, so one is stood in for; what is being
 * tested is which shape appears and how big, not what the browser measures.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')
const DRAWN = 1219.2

/**
 * A point on the slide, as the pointer coordinates that would land on it.
 *
 * Each axis by its own scale: the rectangle stood in for is square and the
 * slide is not, so converting height by the width's scale would put the shape
 * three quarters the size it was drawn and blame the code for it.
 */
const client = (point: { x: number; y: number }) => {
  const size = useDeckStore.getState().open?.deck.slideSize ?? { width: 0, height: 0 }
  return {
    clientX: point.x / (size.width / DRAWN),
    clientY: point.y / (size.height / DRAWN),
  }
}

beforeEach(async () => {
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

  useDeckStore.getState().close()
  useViewStore.setState({
    drawing: null,
    choosingShape: false,
    panels: { filmstrip: true, properties: true, notes: true },
  })

  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })
})

const shapes = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

function drawOut(from: { x: number; y: number }, to: { x: number; y: number }) {
  const background = within(screen.getByTestId('canvas')).getByTestId('slide-background')
  fireEvent.pointerDown(background, client(from))
  fireEvent.pointerMove(window, client(to))
  fireEvent.pointerUp(window, client(to))
}

describe('the shape gallery', () => {
  it('offers only shapes this app can actually draw', () => {
    for (const group of SHAPE_GROUPS) {
      for (const [preset, label] of group.presets) {
        expect(isKnownPreset(preset), `${label} (${preset})`).toBe(true)
      }
    }
  })

  it('arms the shape that was chosen', async () => {
    render(<App />)
    act(() => {
      runCommand('insert.shape', {})
    })

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Decision' }))

    expect(useViewStore.getState().drawing).toBe('flowChartDecision')
    // And puts itself away: the slide is where the next thing happens.
    expect(useViewStore.getState().choosingShape).toBe(false)
  })
})

describe('drawing one out', () => {
  it('makes the shape the size it was dragged', () => {
    render(<App />)
    act(() => {
      useViewStore.getState().setDrawing('ellipse')
    })
    const before = shapes().length

    drawOut({ x: 1_000_000, y: 500_000 }, { x: 3_000_000, y: 1_500_000 })

    const made = shapes()[before]
    expect(shapes()).toHaveLength(before + 1)
    expect(made?.transform?.x).toBe(1_000_000)
    expect(made?.transform?.width).toBe(2_000_000)
    expect(made?.transform?.height).toBe(1_000_000)
  })

  it('makes the shape that was armed', () => {
    render(<App />)
    act(() => {
      useViewStore.getState().setDrawing('flowChartDecision')
    })
    const before = shapes().length

    drawOut({ x: 0, y: 0 }, { x: 2_000_000, y: 1_000_000 })

    expect(shapes()[before]?.properties?.geometry?.preset).toBe('flowChartDecision')
  })

  it('disarms after one, so the next drag selects again', () => {
    render(<App />)
    act(() => {
      useViewStore.getState().setDrawing('rect')
    })

    drawOut({ x: 0, y: 0 }, { x: 2_000_000, y: 1_000_000 })
    expect(useViewStore.getState().drawing).toBeNull()

    const after = shapes().length
    drawOut({ x: 0, y: 0 }, { x: 2_000_000, y: 1_000_000 })
    // The second band selected rather than drew.
    expect(shapes()).toHaveLength(after)
  })

  it('selects what it drew', () => {
    render(<App />)
    act(() => {
      useViewStore.getState().setDrawing('rect')
    })
    const before = shapes().length

    drawOut({ x: 0, y: 0 }, { x: 2_000_000, y: 1_000_000 })

    expect(useDeckStore.getState().selection).toEqual([shapes()[before]?.id])
  })

  it('keeps the selection while a shape is armed, rather than clearing it', () => {
    render(<App />)
    act(() => {
      useDeckStore.getState().selectShapes([shapes()[0]?.id ?? 0])
      useViewStore.getState().setDrawing('rect')
    })

    const background = within(screen.getByTestId('canvas')).getByTestId('slide-background')
    fireEvent.pointerDown(background, client({ x: 0, y: 0 }))

    // Pressing to start drawing is not pressing to deselect.
    expect(useDeckStore.getState().selection).toHaveLength(1)
  })
})
