import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Presenter } from '../components/presenter'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'

/** What the presenter sees while the room sees the slide. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const startAt = (at: number) => {
  act(() => {
    useShowStore.getState().start(at, useDeckStore.getState().open?.deck.slides.length ?? 0)
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
  useShowStore.setState({ at: null, blank: null, typed: '', count: 0, notesScale: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what it shows', () => {
  it('shows nothing when no show is running', async () => {
    await openDeck('many-slides')
    render(<Presenter />)

    expect(screen.queryByTestId('presenter')).toBeNull()
  })

  it('names where in the deck the show is', async () => {
    await openDeck('many-slides')
    startAt(2)
    render(<Presenter />)

    expect(screen.getByText('Slide 3 of 8')).toBeInTheDocument()
  })

  it('shows the slide that is up and the one coming', async () => {
    await openDeck('many-slides')
    startAt(2)
    render(<Presenter />)

    const next = screen.getByLabelText('Next slide')
    expect(next.querySelector('[aria-label*="Slide 4"]')).not.toBeNull()
  })

  it('says so on the last slide rather than showing a blank next one', async () => {
    await openDeck('many-slides')
    startAt(7)
    render(<Presenter />)

    expect(screen.getByLabelText('Next slide')).toHaveTextContent('Last slide')
  })

  it('shows the notes of the slide that is up', async () => {
    await openDeck('notes')
    startAt(0)
    render(<Presenter />)

    expect(screen.getByTestId('presenter-notes').textContent).not.toBe('')
    expect(screen.getByTestId('presenter-notes')).not.toHaveTextContent('No notes')
  })

  it('says a slide has none rather than showing an empty box', async () => {
    await openDeck('many-slides')
    startAt(0)
    render(<Presenter />)

    expect(screen.getByTestId('presenter-notes')).toHaveTextContent('No notes')
  })
})

describe('the two numbers a presenter looks at', () => {
  it('counts from when the show started', async () => {
    await openDeck('many-slides')

    // Only now: reading a deck goes through timers of its own, and freezing
    // them before it is read never lets it finish.
    vi.useFakeTimers()
    act(() => {
      useShowStore.getState().start(0, 8)
    })
    render(<Presenter />)
    expect(screen.getByLabelText('Time on this presentation')).toHaveTextContent('0:00')

    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByLabelText('Time on this presentation')).toHaveTextContent('1:05')
  })

  it('shows a clock as well, which is the other one', async () => {
    await openDeck('many-slides')
    startAt(0)
    render(<Presenter />)

    expect(screen.getByLabelText('Clock').textContent).toMatch(/\d/u)
  })
})

describe('driving the show from it', () => {
  it('moves the show on and back', async () => {
    await openDeck('many-slides')
    startAt(3)
    render(<Presenter />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(useShowStore.getState().at).toBe(4)

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(useShowStore.getState().at).toBe(3)
  })

  it('jumps to a slide from the strip', async () => {
    await openDeck('many-slides')
    startAt(0)
    render(<Presenter />)

    await userEvent.click(screen.getByLabelText('Go to slide 6'))
    expect(useShowStore.getState().at).toBe(5)
  })

  it('blanks the screen and brings it back', async () => {
    await openDeck('many-slides')
    startAt(0)
    render(<Presenter />)

    await userEvent.click(screen.getByRole('button', { name: 'Blank' }))
    expect(useShowStore.getState().blank).toBe('black')

    await userEvent.click(screen.getByRole('button', { name: 'Blank' }))
    expect(useShowStore.getState().blank).toBeNull()
  })

  it('ends the show', async () => {
    await openDeck('many-slides')
    startAt(0)
    render(<Presenter />)

    await userEvent.click(screen.getByRole('button', { name: 'End show' }))
    expect(useShowStore.getState().at).toBeNull()
  })
})

describe('the size of the notes', () => {
  it('grows and shrinks them', async () => {
    await openDeck('notes')
    startAt(0)
    render(<Presenter />)

    const notes = () => screen.getByTestId<HTMLParagraphElement>('presenter-notes')

    await userEvent.click(screen.getByLabelText('Larger notes'))
    expect(notes().style.fontSize).toBe('1.25rem')

    await userEvent.click(screen.getByLabelText('Smaller notes'))
    await userEvent.click(screen.getByLabelText('Smaller notes'))
    expect(notes().style.fontSize).toBe('0.75rem')
  })

  it('stops somewhere sensible at both ends', async () => {
    await openDeck('notes')
    startAt(0)
    render(<Presenter />)

    for (let index = 0; index < 20; index += 1) {
      await userEvent.click(screen.getByLabelText('Smaller notes'))
    }
    expect(useShowStore.getState().notesScale).toBe(0.5)

    for (let index = 0; index < 40; index += 1) {
      await userEvent.click(screen.getByLabelText('Larger notes'))
    }
    expect(useShowStore.getState().notesScale).toBe(4)
  })
})
