import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useEditorStore } from '../store/editor-store'
import { useViewStore } from '../store/view-store'

/** The deck as text: every slide's title and the words under it. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const titles = () =>
  (useDeckStore.getState().open?.deck.slides ?? []).map((slide) =>
    slide.shapes[0]?.text == null ? '' : textOfBody(slide.shapes[0].text),
  )

const showOutline = () => {
  act(() => {
    runCommand('view.outline', {})
  })
}

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    selection: [],
    slideSelection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
  useViewStore.setState({ leftPane: 'filmstrip', editingOutline: null, editingNotes: false })
})

describe('the outline', () => {
  it('replaces the filmstrip and goes back again', async () => {
    await openDeck('many-slides')
    render(<App />)

    showOutline()
    expect(screen.getByLabelText('Outline')).toBeInTheDocument()
    expect(screen.queryByLabelText('Slides')).toBeNull()

    showOutline()
    expect(screen.getByLabelText('Slides')).toBeInTheDocument()
  })

  it('lists the title of every slide', async () => {
    await openDeck('many-slides')
    render(<App />)
    showOutline()

    expect(screen.getByLabelText('Title of slide 1')).toHaveTextContent('Slide 1')
    expect(screen.getByLabelText('Title of slide 8')).toHaveTextContent('Slide 8')
  })

  it('shows the body text under the title', async () => {
    await openDeck('placeholders')
    render(<App />)
    showOutline()

    expect(screen.getByLabelText('Body of slide 1')).toBeInTheDocument()
  })

  it('leaves free text boxes out, which are not what a slide says it is', async () => {
    await openDeck('shapes')
    render(<App />)
    showOutline()

    // Nothing on this slide is a placeholder, so the outline has no lines.
    expect(screen.queryByLabelText('Title of slide 1')).toBeNull()
    expect(screen.getByText('Untitled slide')).toBeInTheDocument()
  })

  it('shows the slide whose line was clicked', async () => {
    await openDeck('many-slides')
    render(<App />)
    showOutline()

    await userEvent.click(screen.getByLabelText('Title of slide 5'))
    expect(useDeckStore.getState().current).toBe(4)
  })
})

describe('editing in the outline', () => {
  it('writes what was typed back to the placeholder', async () => {
    await openDeck('many-slides')
    render(<App />)
    showOutline()

    await userEvent.click(screen.getByLabelText('Title of slide 2'))
    act(() => {
      useEditorStore.getState().editor?.commands.selectAll()
      useEditorStore.getState().editor?.commands.insertContent('Renamed')
    })
    act(() => {
      runCommand('edit.leave-text', {})
    })

    expect(titles()[1]).toBe('Renamed')
  })

  it('is one undo step', async () => {
    await openDeck('many-slides')
    render(<App />)
    showOutline()

    await userEvent.click(screen.getByLabelText('Title of slide 2'))
    act(() => {
      useEditorStore.getState().editor?.commands.selectAll()
      useEditorStore.getState().editor?.commands.insertContent('Something else')
    })
    act(() => {
      runCommand('edit.leave-text', {})
    })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(titles()[1]).toBe('Slide 2')
  })

  it('does not leave the canvas editing the same text at the same time', async () => {
    // Two ProseMirror views over one text body would both commit.
    await openDeck('many-slides')
    render(<App />)
    showOutline()

    act(() => {
      useDeckStore.getState().setEditing(1)
    })
    await userEvent.click(screen.getByLabelText('Title of slide 2'))

    expect(useDeckStore.getState().editing).toBeNull()
    expect(useViewStore.getState().editingOutline).not.toBeNull()
  })

  it('is ended by the one command that ends any text edit', async () => {
    await openDeck('many-slides')
    render(<App />)
    showOutline()

    await userEvent.click(screen.getByLabelText('Title of slide 2'))
    act(() => {
      runCommand('edit.leave-text', {})
    })

    expect(useViewStore.getState().editingOutline).toBeNull()
  })
})
