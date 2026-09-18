import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { getPartText } from '@orangery/ooxml-core'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useEditorStore } from '../store/editor-store'
import { useViewStore } from '../store/view-store'

/** Adding, removing and reordering the slides of a deck. */

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
  useViewStore.setState({ finding: false, zoom: null, editingNotes: false })
})

describe('a new slide', () => {
  it('goes in after the one being shown', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(2)
      runCommand('slide.new', {})
    })

    expect(titles()[2]).toBe('Slide 3')
    expect(titles()[3]).toBe('')
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(9)
  })

  it('becomes the slide being shown', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.new', {})
    })

    expect(useDeckStore.getState().current).toBe(1)
  })

  it('appears in the filmstrip', async () => {
    await openDeck('empty')
    render(<App />)

    act(() => {
      runCommand('slide.new', {})
    })

    expect(screen.getAllByRole('button', { name: /^Slide \d+$/u })).toHaveLength(2)
  })

  it('is taken back in one step, part and all', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('slide.new', {})
    })
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(2)

    act(() => {
      runCommand('edit.undo', {})
    })
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(1)
  })

  it('can be added twice without landing on the same part', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('slide.new', {})
      runCommand('slide.new', {})
    })

    const paths = (useDeckStore.getState().open?.deck.slides ?? []).map((slide) => slide.path)
    expect(new Set(paths).size).toBe(3)
  })
})

describe('removing a slide', () => {
  it('takes it out and steps back', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(3)
      runCommand('slide.delete', {})
    })

    expect(titles()).not.toContain('Slide 4')
    expect(useDeckStore.getState().current).toBe(2)
  })

  it('is greyed out on a deck of one, which PowerPoint will not open empty', async () => {
    await openDeck('empty')
    expect(getCommand('slide.delete')?.isEnabled?.({})).toBe(false)
  })
})

describe('reordering', () => {
  it('moves a slide up and follows it', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(3)
      runCommand('slide.move-up', {})
    })

    expect(titles()[2]).toBe('Slide 4')
    expect(titles()[3]).toBe('Slide 3')
    expect(useDeckStore.getState().current).toBe(2)
  })

  it('moves a slide down', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.move-down', {})
    })

    expect(titles()[0]).toBe('Slide 2')
    expect(titles()[1]).toBe('Slide 1')
  })

  it('stops at the ends', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
    })
    expect(getCommand('slide.move-up')?.isEnabled?.({})).toBe(false)

    act(() => {
      useDeckStore.getState().select(7)
    })
    expect(getCommand('slide.move-down')?.isEnabled?.({})).toBe(false)
  })

  it('leaves the parts where they were, since only the list decides order', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.move-down', {})
    })

    expect(useDeckStore.getState().open?.deck.slides[1]?.path).toBe('ppt/slides/slide1.xml')
  })
})

describe('speaker notes', () => {
  it('says when a slide has no notes page to write on', async () => {
    // Making one is its own operation; pretending otherwise would lose what
    // was typed.
    await openDeck('shapes')
    render(<App />)

    expect(screen.getByText('This slide has no notes page')).toBeInTheDocument()
  })

  it('shows what the notes page holds', async () => {
    await openDeck('notes')
    render(<App />)

    expect(screen.getByText(/The quick brown fox/u)).toBeInTheDocument()
  })

  it('opens an editor on the notes when they are clicked', async () => {
    const user = userEvent.setup()
    await openDeck('notes')
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Edit speaker notes' }))
    expect(document.querySelector('.slide-text')).toBeInTheDocument()
  })

  it('writes the notes into their own part', async () => {
    const user = userEvent.setup()
    await openDeck('notes')
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Edit speaker notes' }))
    act(() => {
      const editor = useEditorStore.getState().editor
      editor?.commands.selectAll()
      editor?.commands.insertContent('Remember the projector')
    })
    await user.keyboard('{Escape}')

    const { open } = useDeckStore.getState()
    const text =
      open === null ? '' : (getPartText(open.package, 'ppt/notesSlides/notesSlide1.xml') ?? '')
    expect(text).toContain('Remember the projector')
  })

  it('leaves the slide itself alone', async () => {
    const user = userEvent.setup()
    await openDeck('notes')
    render(<App />)
    const before = (() => {
      const { open } = useDeckStore.getState()
      return open === null ? '' : (getPartText(open.package, 'ppt/slides/slide1.xml') ?? '')
    })()

    await user.click(screen.getByRole('button', { name: 'Edit speaker notes' }))
    act(() => {
      useEditorStore.getState().editor?.commands.insertContent('x')
    })
    await user.keyboard('{Escape}')

    const { open } = useDeckStore.getState()
    expect(open === null ? '' : getPartText(open.package, 'ppt/slides/slide1.xml')).toBe(before)
  })
})

describe('zoom', () => {
  it('fits the window until something says otherwise', async () => {
    await openDeck('empty')
    expect(getCommand('view.zoom-fit')?.isActive?.({})).toBe(true)
  })

  it('steps out from life size rather than from whatever was fitted', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('view.zoom-in', {})
    })

    expect(useViewStore.getState().zoom).toBeCloseTo(1.25, 5)
  })

  it('goes back to fitting', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('view.zoom-in', {})
      runCommand('view.zoom-fit', {})
    })

    expect(useViewStore.getState().zoom).toBeNull()
  })

  it('stops at the ends of the range', async () => {
    await openDeck('empty')
    act(() => {
      for (let step = 0; step < 20; step += 1) runCommand('view.zoom-in', {})
    })
    expect(useViewStore.getState().zoom).toBe(4)

    act(() => {
      for (let step = 0; step < 40; step += 1) runCommand('view.zoom-out', {})
    })
    expect(useViewStore.getState().zoom).toBe(0.25)
  })
})

describe('duplicating a slide', () => {
  it('puts the copy after the original and shows it', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(2)
      runCommand('slide.duplicate', {})
    })

    expect(titles().slice(2, 5)).toEqual(['Slide 3', 'Slide 3', 'Slide 4'])
    expect(useDeckStore.getState().current).toBe(3)
  })

  it('undoes to the deck that was there before', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.duplicate', {})
    })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(8)
    expect(titles()).toEqual([
      'Slide 1',
      'Slide 2',
      'Slide 3',
      'Slide 4',
      'Slide 5',
      'Slide 6',
      'Slide 7',
      'Slide 8',
    ])
  })

  it('leaves the original alone when the copy is edited', async () => {
    // The copy is a part of its own; sharing one would make this fail.
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.duplicate', {})
    })

    const deck = useDeckStore.getState().open?.deck
    expect(deck?.slides[0]?.path).not.toBe(deck?.slides[1]?.path)
  })
})

describe('changing the layout of a slide', () => {
  it('offers the layouts of the slide master', async () => {
    await openDeck('placeholders')
    render(<App />)
    act(() => {
      runCommand('slide.layout', {})
    })

    const picker = await screen.findByLabelText('Layout')
    expect(picker).toBeInstanceOf(HTMLSelectElement)
    expect((picker as HTMLSelectElement).options.length).toBeGreaterThan(1)
  })

  it('points the slide at the layout that was picked', async () => {
    await openDeck('placeholders')
    render(<App />)
    act(() => {
      runCommand('slide.layout', {})
    })

    const picker = await screen.findByLabelText<HTMLSelectElement>('Layout')
    const other = [...picker.options].find((option) => option.value !== picker.value)
    if (other === undefined) throw new Error('fixture has one layout')

    await userEvent.selectOptions(picker, other.value)

    expect(useDeckStore.getState().open?.deck.slides[0]?.layout).toBe(other.value)
  })

  it('keeps the text that was on the slide', async () => {
    await openDeck('placeholders')
    const before = titles()[0]
    render(<App />)
    act(() => {
      runCommand('slide.layout', {})
    })

    const picker = await screen.findByLabelText<HTMLSelectElement>('Layout')
    const other = [...picker.options].find((option) => option.value !== picker.value)
    if (other === undefined) throw new Error('fixture has one layout')

    await userEvent.selectOptions(picker, other.value)

    expect(titles()[0]).toBe(before)
  })
})
