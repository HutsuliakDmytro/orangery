import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { connectorEnds, createDeck, flatten, geometryPoints } from '@orangery/ooxml-presentation'
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

describe('a selected connector', () => {
  /** Opens the deck that has one, and selects it. */
  async function withConnector() {
    const bytes = await readFile(join(FIXTURES, 'groups-and-connectors.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/connectors.pptx')
    })

    const connector = flatten(shapes()).find((shape) => shape.kind === 'cxnSp')
    if (connector === undefined) throw new Error('fixture has no connector')

    act(() => {
      useDeckStore.getState().selectShapes([connector.id])
    })
    return connector
  }

  const found = (id: number) => flatten(shapes()).find((shape) => shape.id === id)

  it('offers a grip at each end and no sizing handles', async () => {
    await withConnector()
    render(<App />)

    expect(screen.getByRole('button', { name: 'Connector start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connector end' })).toBeInTheDocument()
    // A line has no area, so eight ways to resize a rectangle it happens to
    // span would be eight ways to do the two things that mean anything.
    expect(screen.queryByRole('button', { name: 'Resize nw' })).not.toBeInTheDocument()
  })

  it('lets an end go when it is dropped on nothing', async () => {
    const connector = await withConnector()
    render(<App />)

    const grip = screen.getByRole('button', { name: 'Connector end' })
    fireEvent.pointerDown(grip, client({ x: 0, y: 0 }))
    fireEvent.pointerMove(window, client({ x: 100_000, y: 4_000_000 }))
    fireEvent.pointerUp(window, client({ x: 100_000, y: 4_000_000 }))

    expect(found(connector.id)?.connection?.end).toBeNull()
  })

  it('pins an end to the shape it is dropped on', async () => {
    const connector = await withConnector()
    const target = flatten(shapes()).find(
      (shape) => shape.kind === 'sp' && shape.transform !== null,
    )
    if (target?.transform == null) throw new Error('fixture has no shape to attach to')
    render(<App />)

    const start = connectorEnds(connector.transform as never).end
    const middle = {
      x: target.transform.x + target.transform.width / 2,
      y: target.transform.y + target.transform.height / 2,
    }

    const grip = screen.getByRole('button', { name: 'Connector end' })
    fireEvent.pointerDown(grip, client(start))
    fireEvent.pointerMove(window, client(middle))
    fireEvent.pointerUp(window, client(middle))

    expect(found(connector.id)?.connection?.end?.shapeId).toBe(target.id)
  })
})

describe('editing a shape’s own points', () => {
  /** Draws a shape with custom geometry: the icons are stored that way. */
  async function withCustomShape() {
    await act(async () => {
      await useDeckStore.getState().load(await createDeck(), null)
    })

    act(() => {
      runCommand('insert.icon.triangle', {})
    })

    const shape = flatten(shapes()).find((one) => one.properties?.geometry?.kind === 'custom')
    if (shape === undefined) throw new Error('no custom shape was inserted')

    act(() => {
      useDeckStore.getState().selectShapes([shape.id])
    })
    return shape
  }

  it('is offered for a shape with its own outline and not for a preset', () => {
    render(<App />)
    act(() => {
      useViewStore.getState().setDrawing('rect')
    })
    drawOut({ x: 0, y: 0 }, { x: 2_000_000, y: 1_000_000 })

    // A preset's shape is a name, not a list of corners.
    expect(getCommand('format.edit-points')?.isEnabled?.({})).toBe(false)
  })

  it('shows a handle for every vertex', async () => {
    const shape = await withCustomShape()
    render(<App />)

    act(() => {
      runCommand('format.edit-points', {})
    })

    expect(useDeckStore.getState().editingPoints).toBe(shape.id)
    expect(screen.getAllByRole('button', { name: /^Point \d+$/u }).length).toBeGreaterThan(2)
  })

  it('moves the vertex that was dragged and leaves the rest', async () => {
    await withCustomShape()
    render(<App />)
    act(() => {
      runCommand('format.edit-points', {})
    })

    const before = geometryPoints(
      flatten(shapes()).find((one) => one.id === useDeckStore.getState().editingPoints) as never,
    )

    const handle = screen.getAllByRole('button', { name: /^Point \d+$/u })[0]
    if (handle === undefined) throw new Error('no point handle')
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
    fireEvent.pointerUp(window, { clientX: 20, clientY: 20 })

    const after = geometryPoints(
      flatten(shapes()).find((one) => one.id === useDeckStore.getState().editingPoints) as never,
    )

    expect(after[0]).not.toEqual(before[0])
    expect(after[1]).toEqual(before[1])
  })

  it('adds a corner where the outline is clicked between two', async () => {
    await withCustomShape()
    render(<App />)
    act(() => {
      runCommand('format.edit-points', {})
    })

    const before = screen.getAllByRole('button', { name: /^Point \d+$/u }).length
    const add = screen.getAllByRole('button', { name: /^Add point after \d+$/u })[0]
    if (add === undefined) throw new Error('no add handle')

    fireEvent.pointerDown(add)

    expect(screen.getAllByRole('button', { name: /^Point \d+$/u })).toHaveLength(before + 1)
  })

  it('offers a place to add one on every side, the closing one included', async () => {
    await withCustomShape()
    render(<App />)
    act(() => {
      runCommand('format.edit-points', {})
    })

    // A closed outline's last side is a side like any other.
    const corners = screen.getAllByRole('button', { name: /^Point \d+$/u }).length
    expect(screen.getAllByRole('button', { name: /^Add point after \d+$/u })).toHaveLength(corners)
  })

  it('takes a corner out when it is double-clicked', async () => {
    await withCustomShape()
    render(<App />)
    act(() => {
      runCommand('format.edit-points', {})
    })

    // One added first, because an outline will not go below three corners.
    const add = screen.getAllByRole('button', { name: /^Add point after \d+$/u })[0]
    if (add === undefined) throw new Error('no add handle')
    fireEvent.pointerDown(add)

    const before = screen.getAllByRole('button', { name: /^Point \d+$/u }).length
    const handle = screen.getAllByRole('button', { name: /^Point \d+$/u })[1]
    if (handle === undefined) throw new Error('no point handle')
    fireEvent.doubleClick(handle)

    expect(screen.getAllByRole('button', { name: /^Point \d+$/u })).toHaveLength(before - 1)
  })

  it('keeps the last three corners, because below that there is no shape', async () => {
    await withCustomShape()
    render(<App />)
    act(() => {
      runCommand('format.edit-points', {})
    })

    const corners = screen.getAllByRole('button', { name: /^Point \d+$/u })
    for (const handle of corners) fireEvent.doubleClick(handle)

    expect(screen.getAllByRole('button', { name: /^Point \d+$/u }).length).toBeGreaterThanOrEqual(3)
  })

  it('is left on Escape', async () => {
    await withCustomShape()
    render(<App />)
    act(() => {
      runCommand('format.edit-points', {})
    })

    act(() => {
      runCommand('edit.leave-points', {})
    })

    expect(useDeckStore.getState().editingPoints).toBeNull()
  })
})
