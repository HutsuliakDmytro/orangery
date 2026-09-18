import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { getPartText } from '@orangery/ooxml-core'
import { isMac } from '@orangery/platform'
import { writeFill } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

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
  // The find strip is a toggle, so a test that left it open would flip it shut
  // for the next one — which is how three of these failed before this line.
  useViewStore.setState({ finding: false, grid: false, snapToGrid: false, editingGrid: false })
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
    // The frame itself, four corners and four edges. The handle that turns the
    // shape is a circle, so it is not among them.
    expect(outlines).toHaveLength(9)
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

    // With no shape picked the panel is about the slide itself.
    expect(screen.getByLabelText('Layout')).toBeInTheDocument()
    expect(screen.getByLabelText('Background')).toBeInTheDocument()

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
    await user.click(screen.getByRole('button', { name: 'Fill #FF3B30' }))

    expect(partText()).toContain('FF3B30')
  })

  it('writes a theme colour as the slot rather than as the colour it looks like', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Fill Accent 2' }))

    // The whole difference: a slot follows the theme, a literal does not.
    expect(partText()).toContain('schemeClr val="accent2"')
  })

  it('gives the outline a colour, which it had no way to be given before', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Line #007AFF' }))

    expect(partText()).toContain('007AFF')
  })

  it('fills with a gradient', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Fill gradient' }))

    expect(partText()).toContain('<a:gradFill')
    expect(partText()).toContain('<a:gs')
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
  /** Opens the grid and sweeps to a size, which is how a table is asked for. */
  async function insert(rows = 3, columns = 3) {
    const user = userEvent.setup()
    act(() => {
      runCommand('insert.table', {})
    })
    await user.click(
      await screen.findByRole('button', { name: `${String(rows)} by ${String(columns)}` }),
    )
  }

  it('asks how big before putting one anywhere', async () => {
    await openDeck('empty')
    render(<App />)

    act(() => {
      runCommand('insert.table', {})
    })

    expect(screen.getByRole('dialog', { name: 'Insert Table' })).toBeInTheDocument()
    expect(useDeckStore.getState().open?.deck.slides[0]?.shapes).toHaveLength(0)
  })

  it('puts one on the slide and selects it', async () => {
    await openDeck('empty')
    render(<App />)
    await insert()

    const shapes = useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
    expect(shapes[0]?.graphic?.kind).toBe('table')
    expect(useDeckStore.getState().selection).toEqual([shapes[0]?.id])
  })

  it('makes it the size that was swept, not a fixed three by three', async () => {
    await openDeck('empty')
    render(<App />)
    await insert(2, 5)

    const table = useDeckStore.getState().open?.deck.slides[0]?.shapes[0]?.graphic?.table
    expect(table?.rows).toHaveLength(2)
    expect(table?.rows[0]?.cells).toHaveLength(5)
  })

  it('draws it on the canvas', async () => {
    await openDeck('empty')
    render(<App />)
    await insert()

    // Nine cells, each a rectangle with a text box over it.
    expect(document.querySelectorAll('foreignObject').length).toBeGreaterThanOrEqual(9)
  })

  it('takes it back in one step', async () => {
    await openDeck('empty')
    render(<App />)
    const before = partText()

    await insert()
    act(() => {
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

describe('find and replace', () => {
  const open = () => {
    act(() => {
      runCommand('edit.find', {})
    })
  }

  it('opens from the registry', async () => {
    await openDeck('many-slides')
    render(<App />)
    open()

    expect(screen.getByRole('region', { name: 'Find and replace' })).toBeInTheDocument()
  })

  it('counts the matches and the slides they are on', async () => {
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    open()

    await user.type(screen.getByLabelText('Find'), 'Slide')
    // Where you are as well as how many there are: a count with no position is
    // a number you cannot walk through.
    expect(screen.getByText('1 of 8 on 8 slides')).toBeInTheDocument()
  })

  it('steps to the next match and to the slide it is on', async () => {
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    open()

    await user.type(screen.getByLabelText('Find'), 'Slide')
    await user.click(screen.getByRole('button', { name: 'Next match' }))

    expect(screen.getByText('2 of 8 on 8 slides')).toBeInTheDocument()
    expect(useDeckStore.getState().current).toBe(1)
    // And the shape, because a slide is not an answer to "where is this word".
    expect(useDeckStore.getState().selection).toHaveLength(1)
  })

  it('wraps round rather than stopping at the end', async () => {
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    open()

    await user.type(screen.getByLabelText('Find'), 'Slide')
    await user.click(screen.getByRole('button', { name: 'Previous match' }))

    // A search that refuses to continue is one you restart by hand.
    expect(screen.getByText('8 of 8 on 8 slides')).toBeInTheDocument()
  })

  it('steps on Enter, and back on Shift+Enter', async () => {
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    open()

    const field = screen.getByLabelText('Find')
    await user.type(field, 'Slide')
    await user.type(field, '{Enter}')
    expect(screen.getByText('2 of 8 on 8 slides')).toBeInTheDocument()

    await user.type(field, '{Shift>}{Enter}{/Shift}')
    expect(screen.getByText('1 of 8 on 8 slides')).toBeInTheDocument()
  })

  it('says so when there is nothing', async () => {
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    open()

    await user.type(screen.getByLabelText('Find'), 'nowhere')
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('replaces across every slide as one undoable step', async () => {
    // Replacing a word through a deck is one thing a person did.
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    open()

    await user.type(screen.getByLabelText('Find'), 'Slide')
    await user.type(screen.getByLabelText('Replace with'), 'Page')
    await user.click(screen.getByRole('button', { name: 'Replace all' }))

    expect(partText()).toContain('Page 1')
    expect(useDeckStore.getState().undoStack).toHaveLength(1)
  })

  it('takes the whole replacement back in one step', async () => {
    const user = userEvent.setup()
    await openDeck('many-slides')
    render(<App />)
    const before = partText()
    open()

    await user.type(screen.getByLabelText('Find'), 'Slide')
    await user.type(screen.getByLabelText('Replace with'), 'Page')
    await user.click(screen.getByRole('button', { name: 'Replace all' }))

    act(() => {
      runCommand('edit.undo', {})
    })

    expect(partText()).toBe(before)
    // And the slides it touched beyond this one are back too.
    const second = useDeckStore.getState().open?.deck.slides[1]
    expect(second?.shapes[0]?.text?.paragraphs[0]?.runs[0]?.text).toBe('Slide 2')
  })

  it('leaves the button alone when there is nothing to replace', async () => {
    await openDeck('many-slides')
    render(<App />)
    open()

    expect(screen.getByRole('button', { name: 'Replace all' })).toBeDisabled()
  })
})

describe('shadows', () => {
  it('writes one into the effect list', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Shadow soft' }))

    expect(partText()).toContain('<a:outerShdw')
    expect(partText()).toContain('<a:effectLst>')
  })

  it('takes it away again, and the list with it', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Shadow medium' }))
    await user.click(screen.getByRole('button', { name: 'Shadow none' }))

    // An empty list says "no effects", which is a different answer from not
    // saying anything.
    expect(partText()).not.toContain('a:outerShdw')
    expect(partText()).not.toContain('a:effectLst')
  })

  it('is drawn, not merely recorded', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Shadow hard' }))

    // Before this, a deck where every box had a shadow was drawn flat.
    expect(document.querySelector('feDropShadow')).not.toBeNull()
  })
})

describe('the gradient editor', () => {
  const selectAndFill = async (user: ReturnType<typeof userEvent.setup>) => {
    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    await user.click(screen.getByRole('button', { name: 'Fill gradient' }))
  }

  it('appears only once the fill is a gradient', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([firstShapeId()])
    })
    expect(screen.queryByRole('group', { name: 'Gradient' })).not.toBeInTheDocument()

    await selectAndFill(user)
    expect(screen.getByRole('group', { name: 'Gradient' })).toBeInTheDocument()
  })

  it('moves a stop along', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)
    await selectAndFill(user)

    fireEvent.change(screen.getByLabelText('Stop 1 position'), { target: { value: '30' } })

    // Thousandths of a percent in the file, percent in the panel.
    expect(partText()).toContain('pos="30000"')
  })

  it('turns the gradient round', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)
    await selectAndFill(user)

    await user.click(screen.getByRole('button', { name: 'Gradient 180 degrees' }))

    expect(partText()).toContain('ang="10800000"')
  })

  it('adds a stop and takes it away again', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)
    await selectAndFill(user)
    expect(screen.getAllByLabelText(/Stop \d position/u)).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Add stop' }))
    expect(screen.getAllByLabelText(/Stop \d position/u)).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Remove stop 2' }))
    expect(screen.getAllByLabelText(/Stop \d position/u)).toHaveLength(2)
  })

  it('will not take a gradient below two stops', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)
    await selectAndFill(user)

    // Two is the fewest that is still a gradient; below that it is a colour,
    // and the panel above already does colours.
    expect(screen.getByRole('button', { name: 'Remove stop 1' })).toBeDisabled()
  })

  it('gives a stop a theme colour, which follows the theme', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)
    await selectAndFill(user)

    await user.click(screen.getByRole('button', { name: 'Stop 1 Accent 3' }))

    expect(partText()).toContain('schemeClr val="accent3"')
  })
})

describe('the header and footer dialog', () => {
  /** Opens a deck with several slides and puts the dialog up. */
  async function openDialog() {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      runCommand('insert.header-footer', {})
    })
  }

  const numbered = () => {
    const deck = useDeckStore.getState().open?.deck
    return (deck?.slides ?? []).filter((slide) =>
      slide.shapes.some((shape) => shape.placeholder?.type === 'sldNum'),
    ).length
  }

  it('puts the number on every slide when it is applied to all', async () => {
    const user = userEvent.setup()
    await openDialog()

    await user.click(screen.getByRole('checkbox', { name: 'Slide number' }))
    await user.click(screen.getByRole('button', { name: 'Apply to All' }))

    expect(numbered()).toBe(useDeckStore.getState().open?.deck.slides.length)
  })

  it('puts it on one slide when that is what was asked', async () => {
    const user = userEvent.setup()
    await openDialog()

    await user.click(screen.getByRole('checkbox', { name: 'Slide number' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(numbered()).toBe(1)
  })

  it('writes the footer text into the file', async () => {
    const user = userEvent.setup()
    await openDialog()

    await user.click(screen.getByRole('checkbox', { name: 'Footer' }))
    await user.type(screen.getByRole('textbox', { name: 'Footer text' }), 'Confidential')
    await user.click(screen.getByRole('button', { name: 'Apply to All' }))

    expect(partText()).toContain('Confidential')
  })

  it('leaves the deck alone when it is cancelled', async () => {
    const user = userEvent.setup()
    await openDialog()

    await user.click(screen.getByRole('checkbox', { name: 'Slide number' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(numbered()).toBe(0)
    expect(useDeckStore.getState().saved).toBe(true)
  })

  it('opens on what the slide already shows', async () => {
    const user = userEvent.setup()
    await openDialog()
    await user.click(screen.getByRole('checkbox', { name: 'Slide number' }))
    await user.click(screen.getByRole('button', { name: 'Apply to All' }))

    act(() => {
      runCommand('insert.header-footer', {})
    })

    // Not a form that starts empty: reopening it and pressing Apply again must
    // not be a way to quietly take the numbers back off.
    expect(screen.getByRole('checkbox', { name: 'Slide number' })).toBeChecked()
  })
})

describe('the format painter', () => {
  const shapeAt = (index: number) => useDeckStore.getState().open?.deck.slides[0]?.shapes[index]

  /** Gives the first shape an orange fill, then holds its look. */
  async function pickUpOrange() {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().selectShapes([shapeAt(0)?.id ?? -1])
    })
    act(() => {
      // Through the same write the properties panel uses: the brush should
      // carry whatever a person could have put there.
      useDeckStore.getState().edit((slide) => {
        const shape = slide.shapes[0]
        return (
          shape !== undefined &&
          writeFill(shape, {
            kind: 'solid',
            color: { source: { kind: 'srgb', hex: '#FF7A00' }, transforms: [] },
          })
        )
      })
    })
    act(() => {
      runCommand('format.copy-formatting', {})
    })
  }

  it('is offered only once there is something to paste', async () => {
    await openDeck('shapes')
    render(<App />)
    act(() => {
      useDeckStore.getState().selectShapes([shapeAt(0)?.id ?? -1])
    })

    expect(getCommand('format.paste-formatting')?.isEnabled?.({})).toBe(false)
  })

  it('paints the look onto the shape that is picked out next', async () => {
    await pickUpOrange()

    act(() => {
      useDeckStore.getState().selectShapes([shapeAt(1)?.id ?? -1])
    })
    act(() => {
      runCommand('format.paste-formatting', {})
    })

    const painted = shapeAt(1)
    expect(painted?.properties?.fill).toMatchObject({ kind: 'solid' })
    expect(partText()).toContain('FF7A00')
  })

  it('leaves the painted shape where it was and what it was', async () => {
    await pickUpOrange()
    const before = shapeAt(1)?.transform
    const geometry = shapeAt(1)?.properties?.geometry?.preset

    act(() => {
      useDeckStore.getState().selectShapes([shapeAt(1)?.id ?? -1])
    })
    act(() => {
      runCommand('format.paste-formatting', {})
    })

    expect(shapeAt(1)?.transform).toEqual(before)
    expect(shapeAt(1)?.properties?.geometry?.preset).toBe(geometry)
  })

  it('is one step to undo', async () => {
    await pickUpOrange()
    const steps = useDeckStore.getState().undoStack.length
    const before = shapeAt(1)?.properties?.fill

    act(() => {
      useDeckStore.getState().selectShapes([shapeAt(1)?.id ?? -1])
    })
    act(() => {
      runCommand('format.paste-formatting', {})
    })
    expect(useDeckStore.getState().undoStack.length).toBe(steps + 1)
    expect(shapeAt(1)?.properties?.fill).not.toEqual(before)

    act(() => {
      useDeckStore.getState().undo()
    })
    // The whole paint, not the fill and then the outline and then the text.
    expect(shapeAt(1)?.properties?.fill).toEqual(before)
  })
})

describe('the grid', () => {
  it('is not drawn until it is asked for', async () => {
    await openDeck('shapes')
    render(<App />)

    expect(screen.queryByTestId('grid')).not.toBeInTheDocument()
  })

  it('appears behind the slide when it is', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      runCommand('view.grid-and-guides', {})
    })
    await user.click(screen.getByRole('checkbox', { name: 'Display grid on screen' }))

    expect(screen.getByTestId('grid')).toBeInTheDocument()
  })

  it('remembers its spacing in the file rather than in the session', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      runCommand('view.grid-and-guides', {})
    })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grid spacing' }), '228600')

    // A grid you set again every morning is not doing its job.
    const { open } = useDeckStore.getState()
    expect(getPartText(open?.package ?? { parts: new Map() }, 'ppt/viewProps.xml')).toContain(
      'cx="228600"',
    )
  })

  it('is shown and snapped to as two separate answers', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      runCommand('view.snap-to-grid', {})
    })

    // Wanting things lined up is not wanting to look at the lines.
    expect(getCommand('view.snap-to-grid')?.isActive?.({})).toBe(true)
    expect(getCommand('view.grid')?.isActive?.({})).toBe(false)
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument()
  })
})
