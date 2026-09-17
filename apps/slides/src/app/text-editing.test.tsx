import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { App } from './app'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { useDeckStore } from '../store/deck-store'
import { useEditorStore } from '../store/editor-store'

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

describe('an empty placeholder', () => {
  /** A deck whose title placeholder has had its text removed. */
  async function withEmptyTitle() {
    await openDeck('placeholders')
    const title = useDeckStore
      .getState()
      .open?.deck.slides[0]?.shapes.find((shape) => shape.placeholder?.type === 'title')

    act(() => {
      useDeckStore.getState().setEditing(title?.id ?? null)
    })
    act(() => {
      useEditorStore.getState().editor?.commands.clearContent()
      useDeckStore.getState().setEditing(null)
    })

    return title
  }

  it('shows a prompt on the slide', async () => {
    const { rerender } = render(<App />)
    await withEmptyTitle()
    rerender(<App />)

    expect(screen.getAllByText('Click to add title').length).toBeGreaterThan(0)
  })

  it('never writes the prompt into the file', async () => {
    // A deck of untouched placeholders must open elsewhere as empty boxes, not
    // as the word "Title".
    const { rerender } = render(<App />)
    await withEmptyTitle()
    rerender(<App />)

    expect(partText()).not.toContain('Click to add')
  })

  it('says nothing in a text box somebody emptied on purpose', async () => {
    await openDeck('shapes')
    render(<App />)

    expect(screen.queryByText('Click to add text')).not.toBeInTheDocument()
  })
})

describe('formatting the text being edited', () => {
  it('is greyed out while nothing is being edited', async () => {
    await openDeck('shapes')
    render(<App />)

    expect(getCommand('format.bold')?.isEnabled?.({})).toBe(false)
  })

  it('bolds the selection and writes it', async () => {
    await openDeck('shapes')
    const { rerender } = render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    act(() => {
      useEditorStore.getState().editor?.commands.selectAll()
      runCommand('format.bold', {})
    })
    act(() => {
      useDeckStore.getState().setEditing(null)
    })
    rerender(<App />)

    expect(partText()).toContain('b="1"')
  })

  it('reports whether the cursor is in bold text', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    expect(getCommand('format.bold')?.isActive?.({})).toBe(false)

    act(() => {
      useEditorStore.getState().editor?.commands.selectAll()
      runCommand('format.bold', {})
    })
    expect(getCommand('format.bold')?.isActive?.({})).toBe(true)
  })

  it('demotes a paragraph and the level survives the file', async () => {
    await openDeck('shapes')
    const { rerender } = render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    act(() => {
      runCommand('format.demote', {})
      runCommand('format.demote', {})
    })
    act(() => {
      useDeckStore.getState().setEditing(null)
    })
    rerender(<App />)

    const shape = useDeckStore.getState().open?.deck.slides[0]?.shapes[0]
    expect(shape?.text?.paragraphs[0]?.properties.level).toBe(2)
  })

  it('stops at the outermost level rather than going negative', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    act(() => {
      runCommand('format.promote', {})
      runCommand('format.promote', {})
    })

    expect(
      Number(useEditorStore.getState().editor?.getAttributes('paragraph')['level'] ?? -1),
    ).toBe(0)
  })
})

describe('paragraph formatting', () => {
  /** Enters the first shape, runs commands, leaves, and returns the file text. */
  async function withEditor(run: () => void) {
    await openDeck('shapes')
    const { rerender } = render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    act(run)
    act(() => {
      useDeckStore.getState().setEditing(null)
    })
    rerender(<App />)

    return partText()
  }

  it('centres a paragraph and the file says so', async () => {
    const text = await withEditor(() => {
      runCommand('format.text-centre', {})
    })

    expect(text).toContain('algn="ctr"')
  })

  it('clears the alignment when the same one is chosen again', async () => {
    // Which puts the inherited alignment back rather than freezing today's
    // answer into the file.
    const text = await withEditor(() => {
      runCommand('format.text-centre', {})
      runCommand('format.text-centre', {})
    })

    expect(text).not.toContain('algn=')
  })

  it('turns a paragraph into a bulleted one', async () => {
    const text = await withEditor(() => {
      runCommand('format.bullet', {})
    })

    expect(text).toContain('a:buChar')
  })

  it("goes back to the level's bullet rather than to none", async () => {
    const text = await withEditor(() => {
      runCommand('format.bullet', {})
      runCommand('format.bullet', {})
    })

    expect(text).not.toContain('a:buChar')
    expect(text).not.toContain('a:buNone')
  })

  it('states no bullet when that is what was asked for', async () => {
    const text = await withEditor(() => {
      runCommand('format.no-bullet', {})
    })

    expect(text).toContain('a:buNone')
  })

  it('reports what the paragraph under the cursor has', async () => {
    await openDeck('shapes')
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    expect(getCommand('format.bullet')?.isActive?.({})).toBe(false)

    act(() => {
      runCommand('format.bullet', {})
    })
    expect(getCommand('format.bullet')?.isActive?.({})).toBe(true)
  })
})
