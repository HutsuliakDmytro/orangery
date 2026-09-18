import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { getPartText, parseXml, setPartText } from '@orangery/ooxml-core'
import { saveDeck } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useEditorStore } from '../store/editor-store'
import { useViewStore } from '../store/view-store'

/** How a shape holds its text, and shapes that hold none yet. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const partText = () =>
  getPartText(
    useDeckStore.getState().open?.package ?? { parts: new Map() },
    'ppt/slides/slide1.xml',
  ) ?? ''

const firstShape = () => useDeckStore.getState().open?.deck.slides[0]?.shapes[0]

const select = () => {
  act(() => {
    useDeckStore.getState().selectShapes([firstShape()?.id ?? -1])
  })
}

beforeEach(() => {
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
  useViewStore.setState({ leftPane: 'filmstrip', editingOutline: null, editingNotes: false })
})

describe('the text box controls', () => {
  it('sets where the text sits', async () => {
    await openDeck('shapes')
    render(<App />)
    select()

    fireEvent.change(screen.getByLabelText('Vertical anchor'), { target: { value: 'b' } })

    expect(firstShape()?.text?.bodyProperties?.anchor).toBe('b')
  })

  it('clears the anchor rather than writing the default in its place', async () => {
    await openDeck('shapes')
    render(<App />)
    select()

    fireEvent.change(screen.getByLabelText('Vertical anchor'), { target: { value: 'b' } })
    fireEvent.change(screen.getByLabelText('Vertical anchor'), { target: { value: '' } })

    expect(firstShape()?.text?.bodyProperties?.anchor).toBeNull()
  })

  it('turns wrapping off', async () => {
    await openDeck('shapes')
    render(<App />)
    select()

    await userEvent.click(screen.getByLabelText('Wrap text in shape'))

    expect(firstShape()?.text?.bodyProperties?.wrap).toBe('none')
  })

  it('asks for shrinking without claiming a scale', async () => {
    await openDeck('shapes')
    render(<App />)
    select()

    fireEvent.change(screen.getByLabelText('Autofit'), { target: { value: 'shrink' } })

    expect(partText()).toContain('<a:normAutofit/>')
  })

  it('sets an inset in points and writes it in EMU', async () => {
    await openDeck('shapes')
    render(<App />)
    select()

    fireEvent.change(screen.getByLabelText('Inset left'), { target: { value: '0' } })

    expect(firstShape()?.text?.bodyProperties?.insets.left).toBe(0)
  })

  it('is one undo step', async () => {
    await openDeck('shapes')
    render(<App />)
    select()
    const before = partText()

    fireEvent.change(screen.getByLabelText('Vertical anchor'), { target: { value: 'b' } })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(partText()).toBe(before)
  })
})

describe('a shape that holds no text yet', () => {
  /** The same deck with the first shape's text body taken out of the file. */
  async function withoutTextBody() {
    const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
    })

    const open = useDeckStore.getState().open
    if (open === null) throw new Error('did not open')

    const stripped = (getPartText(open.package, 'ppt/slides/slide1.xml') ?? '').replace(
      /<p:txBody>.*?<\/p:txBody>/su,
      '',
    )
    setPartText(open.package, 'ppt/slides/slide1.xml', stripped)

    const again = await saveDeck(open.package)
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(again), '/decks/shapes.pptx')
    })
  }

  it('really has none to start with', async () => {
    await withoutTextBody()
    expect(firstShape()?.text).toBeNull()
    expect(parseXml(partText())).not.toHaveLength(0)
  })

  it('is given one when it is entered', async () => {
    await withoutTextBody()
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })

    expect(firstShape()?.text).not.toBeNull()
  })

  it('starts empty, so everything about it still comes from the theme', async () => {
    await withoutTextBody()
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })

    const body = firstShape()?.text
    expect(body?.paragraphs).toHaveLength(1)
    expect(body?.bodyProperties?.anchor).toBeNull()
  })

  it('keeps what is typed into it', async () => {
    await withoutTextBody()
    render(<App />)

    act(() => {
      useDeckStore.getState().setEditing(firstShape()?.id ?? null)
    })
    await screen.findByLabelText('Font')
    act(() => {
      useEditorStore.getState().editor?.commands.insertContent('Typed here')
    })
    act(() => {
      runCommand('edit.leave-text', {})
    })

    expect(partText()).toContain('Typed here')
  })
})
