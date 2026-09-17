import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { getPartText } from '@orangery/ooxml-core'
import { isMac } from '@orangery/platform'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'

/**
 * Selecting and moving shapes, and taking it back.
 *
 * The state under test is the file: every assertion about an edit reads what
 * the slide part says, because the model is a view over it and agreeing with
 * itself proves nothing.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** The slide part as text, which is what a save would write. */
const partText = () => {
  const { open, current } = useDeckStore.getState()
  const slide = open?.deck.slides[current]
  return open === null || slide === undefined ? '' : (getPartText(open.package, slide.path) ?? '')
}

const firstShapeId = () => useDeckStore.getState().open?.deck.slides[0]?.shapes[0]?.id ?? -1

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    selection: [],
    undoStack: [],
    redoStack: [],
    error: null,
  })
})

describe('selecting', () => {
  it('selects the shape that was clicked', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: 'Rectangle 1' })[0] as HTMLElement)

    expect(useDeckStore.getState().selection).toEqual([firstShapeId()])
  })

  it('replaces the selection unless shift is held', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: 'Rectangle 1' })[0] as HTMLElement)
    await user.click(screen.getAllByRole('button', { name: 'Oval 2' })[0] as HTMLElement)
    expect(useDeckStore.getState().selection).toHaveLength(1)

    await user.keyboard('{Shift>}')
    await user.click(screen.getAllByRole('button', { name: 'Rectangle 1' })[0] as HTMLElement)
    await user.keyboard('{/Shift}')
    expect(useDeckStore.getState().selection).toHaveLength(2)
  })

  it('draws a frame around what is selected', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })

    const outlines = [...document.querySelectorAll('rect[stroke="#FF7A00"]')]
    // The frame itself and four corner handles.
    expect(outlines).toHaveLength(5)
  })

  it('drops the selection on moving to another slide', async () => {
    // The ids mean something else there.
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().selectShapes([2])
      useDeckStore.getState().select(1)
    })

    expect(useDeckStore.getState().selection).toEqual([])
  })

  it('selects everything on the slide from the registry', async () => {
    await openDeck('shapes')
    act(() => {
      runCommand('edit.select-all', {})
    })

    expect(useDeckStore.getState().selection).toHaveLength(4)
  })
})

describe('nudging', () => {
  it('moves the selected shape in the file, not only in the model', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.nudge-right', {})
    })

    // 457200 plus one point.
    expect(partText()).toContain('x="469900"')
  })

  it('does nothing with nothing selected', async () => {
    await openDeck('shapes')
    const before = partText()

    expect(getCommand('edit.nudge-right')?.isEnabled?.({})).toBe(false)
    act(() => {
      runCommand('edit.nudge-right', {})
    })

    expect(partText()).toBe(before)
    expect(useDeckStore.getState().undoStack).toHaveLength(0)
  })

  it('moves every selected shape, not just the first', async () => {
    await openDeck('shapes')
    act(() => {
      runCommand('edit.select-all', {})
      runCommand('edit.nudge-down', {})
    })

    const text = partText()
    // All four started at y=1371600.
    expect(text.match(/y="1384300"/gu)).toHaveLength(4)
  })
})

describe('undo', () => {
  it('puts the file back exactly as it was', async () => {
    await openDeck('shapes')
    const before = partText()

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.nudge-right', {})
    })
    expect(partText()).not.toBe(before)

    act(() => {
      runCommand('edit.undo', {})
    })
    expect(partText()).toBe(before)
  })

  it('redoes what it took back', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.nudge-right', {})
    })
    const moved = partText()

    act(() => {
      runCommand('edit.undo', {})
      runCommand('edit.redo', {})
    })

    expect(partText()).toBe(moved)
  })

  it('walks back through several steps', async () => {
    await openDeck('shapes')
    const before = partText()

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.nudge-right', {})
      runCommand('edit.nudge-right', {})
      runCommand('edit.nudge-down', {})
    })
    expect(useDeckStore.getState().undoStack).toHaveLength(3)

    act(() => {
      runCommand('edit.undo', {})
      runCommand('edit.undo', {})
      runCommand('edit.undo', {})
    })
    expect(partText()).toBe(before)
  })

  it('drops what was undone once something new is done', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.nudge-right', {})
      runCommand('edit.undo', {})
    })
    expect(useDeckStore.getState().redoStack).toHaveLength(1)

    act(() => {
      runCommand('edit.nudge-down', {})
    })
    expect(useDeckStore.getState().redoStack).toHaveLength(0)
  })

  it('is greyed out with nothing to take back', async () => {
    await openDeck('shapes')
    expect(getCommand('edit.undo')?.isEnabled?.({})).toBe(false)
    expect(getCommand('edit.redo')?.isEnabled?.({})).toBe(false)
  })

  it('leaves the model agreeing with the file after undoing', async () => {
    // The model is re-read from the package, so a stale one would show the
    // shape in the moved position with the file saying otherwise.
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.nudge-right', {})
      runCommand('edit.undo', {})
    })

    expect(useDeckStore.getState().open?.deck.slides[0]?.shapes[0]?.transform?.x).toBe(457200)
  })
})

describe('the keyboard', () => {
  it('runs a registry command from its own shortcut', async () => {
    // A menu that shows a shortcut which does nothing is worse than no shortcut.
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.keyboard('{ArrowRight}')

    expect(partText()).toContain('x="469900"')
  })

  it('undoes with the platform modifier', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)
    const before = partText()

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.keyboard('{ArrowRight}')
    await user.keyboard(isMac ? '{Meta>}z{/Meta}' : '{Control>}z{/Control}')

    expect(partText()).toBe(before)
  })

  it('leaves a shortcut alone while something is being typed into', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(
      <>
        <App />
        <input aria-label="somewhere to type" />
      </>,
    )

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    const before = partText()

    await user.click(screen.getByLabelText('somewhere to type'))
    await user.keyboard('{ArrowRight}')

    expect(partText()).toBe(before)
  })
})

describe('dragging', () => {
  /** A drag that starts on the shape and ends elsewhere, in pixels. */
  function dragBy(label: string, dx: number, dy: number) {
    const target = screen.getAllByRole('button', { name: label })[0] as HTMLElement
    // jsdom reports a zero-sized canvas, so the scale is given directly.
    fireEvent.pointerDown(target, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: dx, clientY: dy })
    fireEvent.pointerUp(window, { clientX: dx, clientY: dy })
  }

  it('selects the shape it starts on', async () => {
    await openDeck('shapes')
    render(<App />)

    dragBy('Rectangle 1', 10, 10)
    expect(useDeckStore.getState().selection).toEqual([firstShapeId()])
  })

  it('leaves the file alone when the canvas has no size to scale by', async () => {
    // jsdom lays nothing out, so every rectangle is zero wide. A drag that
    // cannot work out its scale must do nothing rather than divide by zero.
    await openDeck('shapes')
    render(<App />)
    const before = partText()

    dragBy('Rectangle 1', 100, 100)
    expect(partText()).toBe(before)
  })
})

describe('arranging', () => {
  it('aligns the selection to its own bounds', async () => {
    await openDeck('shapes')
    act(() => {
      runCommand('edit.select-all', {})
      runCommand('format.align-left', {})
    })

    // All four to the leftmost shape's x.
    expect(partText().match(/x="457200"/gu)?.length).toBeGreaterThanOrEqual(4)
  })

  it('spreads three or more evenly and greys out below that', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    expect(getCommand('format.distribute-horizontal')?.isEnabled?.({})).toBe(false)

    act(() => {
      runCommand('edit.select-all', {})
    })
    expect(getCommand('format.distribute-horizontal')?.isEnabled?.({})).toBe(true)
  })

  it('brings a shape to the front in the file', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('format.front', {})
    })

    const text = partText()
    expect(text.lastIndexOf('Rectangle 1')).toBeGreaterThan(text.indexOf('5-Point Star 4'))
  })

  it('duplicates the selection and selects the copies', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.duplicate', {})
    })

    const slide = useDeckStore.getState().open?.deck.slides[0]
    expect(slide?.shapes).toHaveLength(5)
    expect(useDeckStore.getState().selection).toEqual([slide?.shapes[4]?.id])
  })

  it('takes a duplicate back in one step', async () => {
    // Duplicating is one action; undoing it should not need two.
    await openDeck('shapes')
    const before = partText()

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.duplicate', {})
      runCommand('edit.undo', {})
    })

    expect(partText()).toBe(before)
  })
})

describe('grouping', () => {
  it('needs more than one shape', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })

    expect(getCommand('format.group')?.isEnabled?.({})).toBe(false)
  })

  it('groups the selection and selects the group', async () => {
    await openDeck('shapes')
    act(() => {
      runCommand('edit.select-all', {})
      runCommand('format.group', {})
    })

    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    expect(shapes).toHaveLength(1)
    expect(shapes[0]?.kind).toBe('grpSp')
    expect(useDeckStore.getState().selection).toEqual([shapes[0]?.id])
  })

  it('offers to ungroup only a group', async () => {
    await openDeck('shapes')
    act(() => {
      runCommand('edit.select-all', {})
    })
    expect(getCommand('format.ungroup')?.isEnabled?.({})).toBe(false)

    act(() => {
      runCommand('format.group', {})
    })
    expect(getCommand('format.ungroup')?.isEnabled?.({})).toBe(true)
  })

  it('puts the shapes back where they were, through the file', async () => {
    await openDeck('shapes')
    const before = partText()

    act(() => {
      runCommand('edit.select-all', {})
      runCommand('format.group', {})
      runCommand('format.ungroup', {})
    })

    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    expect(shapes).toHaveLength(4)
    expect(shapes[0]?.transform?.x).toBe(457200)
    expect(before).toContain('x="457200"')
  })

  it('is two undo steps, because it was two actions', async () => {
    await openDeck('shapes')
    act(() => {
      runCommand('edit.select-all', {})
      runCommand('format.group', {})
      runCommand('format.ungroup', {})
    })
    expect(useDeckStore.getState().undoStack).toHaveLength(2)

    act(() => {
      runCommand('edit.undo', {})
    })
    expect(
      useDeckStore.getState().open?.deck.slides[0]?.shapes.some((shape) => shape.kind === 'grpSp'),
    ).toBe(true)
  })
})

describe('inserting and deleting', () => {
  it('adds a shape to the slide and selects it', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('insert.ellipse', {})
    })

    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    expect(shapes).toHaveLength(1)
    expect(shapes[0]?.properties?.geometry?.preset).toBe('ellipse')
    expect(useDeckStore.getState().selection).toEqual([shapes[0]?.id])
  })

  it('centres it on the slide', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('insert.rect', {})
    })

    const shape = useDeckStore.getState().open?.deck.slides[0]?.shapes[0]?.transform
    const size = useDeckStore.getState().open?.deck.slideSize
    expect((shape?.x ?? 0) + (shape?.width ?? 0) / 2).toBe((size?.width ?? 0) / 2)
  })

  it('deletes the selection and clears it', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.delete', {})
    })

    expect(useDeckStore.getState().open?.deck.slides[0]?.shapes).toHaveLength(3)
    expect(useDeckStore.getState().selection).toEqual([])
  })

  it('takes a deletion back', async () => {
    await openDeck('shapes')
    const before = partText()

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
      runCommand('edit.delete', {})
      runCommand('edit.undo', {})
    })

    expect(partText()).toBe(before)
  })
})

describe('the properties panel', () => {
  it('says what is selected', async () => {
    await openDeck('shapes')
    render(<App />)
    expect(screen.getByText('Nothing selected')).toBeInTheDocument()

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    expect(screen.getByText('Rectangle 1')).toBeInTheDocument()
  })

  it('writes a fill the file keeps', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Fill #FF7A00' }))

    expect(partText()).toContain('FF7A00')
  })

  it('changes every selected shape at once, in one step', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      runCommand('edit.select-all', {})
    })
    await user.click(screen.getByRole('button', { name: 'Line thick' }))

    expect(partText().match(/w="57150"/gu)).toHaveLength(4)
    expect(useDeckStore.getState().undoStack).toHaveLength(1)
  })
})

describe('tables', () => {
  it('puts one on the slide and selects it', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('insert.table', {})
    })

    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    expect(shapes[0]?.graphic?.kind).toBe('table')
    expect(useDeckStore.getState().selection).toEqual([shapes[0]?.id])
  })

  it('draws it on the canvas', async () => {
    await openDeck('empty')
    render(<App />)

    act(() => {
      runCommand('insert.table', {})
    })

    // Nine cells, each a rectangle with a text box over it.
    expect(document.querySelectorAll('foreignObject').length).toBeGreaterThanOrEqual(9)
  })

  it('takes it back in one step', async () => {
    await openDeck('empty')
    const before = partText()

    act(() => {
      runCommand('insert.table', {})
      runCommand('edit.undo', {})
    })

    expect(partText()).toBe(before)
  })
})

describe('connectors', () => {
  it('needs exactly two shapes', async () => {
    await openDeck('shapes')
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    expect(getCommand('insert.connector')?.isEnabled?.({})).toBe(false)

    act(() => {
      runCommand('edit.select-all', {})
    })
    // Four selected says nothing about which pair to join.
    expect(getCommand('insert.connector')?.isEnabled?.({})).toBe(false)
  })

  it('joins the two that are selected', async () => {
    await openDeck('shapes')
    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

    act(() => {
      useDeckStore.getState().selectShapes([shapes[0]?.id ?? 0, shapes[1]?.id ?? 0])
      runCommand('insert.connector', {})
    })

    const after = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    const connector = after[after.length - 1]

    expect(connector?.kind).toBe('cxnSp')
    expect(connector?.connection?.start?.shapeId).toBe(shapes[0]?.id)
    expect(connector?.connection?.end?.shapeId).toBe(shapes[1]?.id)
  })
})
