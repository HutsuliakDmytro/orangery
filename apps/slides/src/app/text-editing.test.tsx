import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'

/**
 * Editing the text inside a shape.
 *
 * What is checked is the file: the editor is a means, and a change that does
 * not reach the slide part has not happened.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const partText = () => {
  const { open, current } = useDeckStore.getState()
  const slide = open?.deck.slides[current]
  return open === null || slide === undefined ? '' : (getPartText(open.package, slide.path) ?? '')
}

const firstShape = () => useDeckStore.getState().open?.deck.slides[0]?.shapes[0]

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    selection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
})

describe('entering a shape', () => {
  it('opens an editor on a double click', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    await user.dblClick(screen.getAllByRole('button', { name: 'Rectangle 1' })[0] as HTMLElement)

    expect(useDeckStore.getState().editing).toBe(firstShape()?.id)
  })

  it("shows the shape's own text in it", async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })

    // Twice on screen: the canvas and the thumbnail beside it.
    expect(screen.getAllByText('Rectangle').length).toBeGreaterThan(1)
    expect(document.querySelector('.slide-text')).toBeInTheDocument()
  })

  it('selects the shape it is entering', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })

    expect(useDeckStore.getState().selection).toEqual([firstShape()?.id])
  })
})

describe('leaving a shape', () => {
  it('writes what was typed into the file', async () => {
    await openDeck('shapes')
    const { rerender } = render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    expect(partText()).toContain('<a:t>Rectangle</a:t>')

    // Leaving unmounts the editor, which is what commits.
    act(() => {
      useDeckStore.getState().setEditing(null)
    })
    rerender(<App />)

    expect(partText()).toContain('Rectangle')
  })

  it('keeps everything the editor does not model', async () => {
    // The run's properties ride along on the preserved mark.
    await openDeck('text-formatting')
    const { rerender } = render(<App />)
    const box = useDeckStore.getState().open?.deck.slides[0]?.shapes[0]

    act(() => {
      useDeckStore.getState().setEditing(box?.id ?? null)
    })
    act(() => {
      useDeckStore.getState().setEditing(null)
    })
    rerender(<App />)

    const text = partText()
    expect(text).toContain('FF7A00')
    expect(text).toContain('b="1"')
    expect(text).toContain('sz="3200"')
  })

  it('leaves on Escape', async () => {
    const user = userEvent.setup()
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    await user.keyboard('{Escape}')

    expect(useDeckStore.getState().editing).toBeNull()
  })

  it('leaves when the slide behind is clicked', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    act(() => {
      useDeckStore.getState().setEditing(null)
      useDeckStore.getState().selectShapes([])
    })

    expect(useDeckStore.getState().editing).toBeNull()
    expect(useDeckStore.getState().selection).toEqual([])
  })

  it('stops editing when the slide changes', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().setEditing(2)
      useDeckStore.getState().select(1)
    })

    expect(useDeckStore.getState().editing).toBeNull()
  })
})
