import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { readSections, sectionOfSlide, slidesOfSection } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/** Sections: the named runs a long deck is divided into. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const sections = () => readSections(useDeckStore.getState().open?.package ?? { parts: new Map() })

/** Cuts the open deck into "Default Section" and one starting at `start`. */
const cutAt = (start: number, name: string) => {
  act(() => {
    useDeckStore.getState().select(start)
    runCommand('section.add', {})
  })
  act(() => {
    useViewStore.getState().setRenamingSection(null)
  })

  const added = sections().at(-1)
  if (added === undefined) throw new Error('no section was added')
  return { id: added.id, name }
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
  useViewStore.setState({ collapsedSections: [], renamingSection: null })
})

describe('adding a section', () => {
  it('splits the deck at the slide being shown', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')

    expect(sections().map((section) => section.start)).toEqual([0, 4])
  })

  it('goes straight into typing the name', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(4)
      runCommand('section.add', {})
    })

    expect(await screen.findByLabelText('Section name')).toHaveValue('Untitled Section')
  })

  it('keeps what was typed', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(4)
      runCommand('section.add', {})
    })

    const field = await screen.findByLabelText('Section name')
    await userEvent.clear(field)
    await userEvent.type(field, 'Second half{Enter}')

    expect(sections().map((section) => section.name)).toEqual(['Default Section', 'Second half'])
  })

  it('leaves the name alone when the typing is abandoned', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(4)
      runCommand('section.add', {})
    })

    const field = await screen.findByLabelText('Section name')
    await userEvent.type(field, 'half{Escape}')

    expect(sections().map((section) => section.name)).toEqual([
      'Default Section',
      'Untitled Section',
    ])
  })
})

describe('the filmstrip with sections', () => {
  it('puts a header above each run of slides', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    expect(screen.getByLabelText('Section Default Section')).toBeInTheDocument()
    expect(screen.getByLabelText('Section Untitled Section')).toBeInTheDocument()
  })

  it('says how many slides are in each', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    expect(screen.getByLabelText('Section Default Section')).toHaveTextContent('(4)')
    expect(screen.getByLabelText('Section Untitled Section')).toHaveTextContent('(4)')
  })

  it('folds a section shut without taking the slides out of the deck', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    await userEvent.click(screen.getByLabelText('Collapse section Default Section'))

    expect(screen.queryByLabelText('Slide 1')).toBeNull()
    expect(screen.getByLabelText('Slide 5')).toBeInTheDocument()
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(8)
  })

  it('opens it again', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    await userEvent.click(screen.getByLabelText('Collapse section Default Section'))
    await userEvent.click(screen.getByLabelText('Expand section Default Section'))

    expect(screen.getByLabelText('Slide 1')).toBeInTheDocument()
  })

  it('picks out the slides of a section when its name is clicked', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    await userEvent.click(screen.getByLabelText('Section Untitled Section'))

    expect(useDeckStore.getState().slideSelection).toEqual([4, 5, 6, 7])
  })

  it('renames on a double click', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    await userEvent.dblClick(screen.getByLabelText('Section Untitled Section'))
    const field = await screen.findByLabelText('Section name')
    await userEvent.clear(field)
    await userEvent.type(field, 'Closing{Enter}')

    expect(screen.getByLabelText('Section Closing')).toBeInTheDocument()
  })
})

describe('removing a section', () => {
  it('leaves its slides in the one before it', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    act(() => {
      useDeckStore.getState().select(5)
      runCommand('section.remove', {})
    })

    expect(sections()).toHaveLength(1)
    expect(slidesOfSection(sections(), 0, 8)).toHaveLength(8)
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(8)
  })

  it('is offered only where there is a section to remove', async () => {
    await openDeck('many-slides')
    expect(sections()).toEqual([])
    act(() => {
      useDeckStore.getState().select(0)
    })

    // Nothing to remove, and nothing to rename either.
    expect(runCommand('section.remove', {})).toBe(false)
    expect(runCommand('section.rename', {})).toBe(false)
  })
})

describe('sections and the slides under them', () => {
  it('follows a slide dragged into another section', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')
    render(<App />)

    const thumbnail = (index: number) => screen.getByLabelText(`Slide ${String(index + 1)}`)
    fireEvent.dragStart(thumbnail(0))
    fireEvent.dragOver(thumbnail(5))
    fireEvent.drop(thumbnail(5))

    // It landed at the sixth slide, which is inside the second section.
    expect(sectionOfSlide(sections(), 5)).toBe(1)
    expect(slidesOfSection(sections(), 0, 8)).toEqual([0, 1, 2])
  })

  it('keeps the boundary on the same slide when one is deleted before it', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')

    act(() => {
      useDeckStore.getState().selectSlides([0])
      runCommand('slide.delete', {})
    })

    expect(sections().map((section) => section.start)).toEqual([0, 3])
    expect(slidesOfSection(sections(), 1, 7)).toEqual([3, 4, 5, 6])
  })

  it('puts a duplicated slide in the section it landed in', async () => {
    await openDeck('many-slides')
    cutAt(4, 'Second half')

    act(() => {
      useDeckStore.getState().selectSlides([5])
      runCommand('slide.duplicate', {})
    })

    expect(sections().map((section) => section.start)).toEqual([0, 4])
    expect(slidesOfSection(sections(), 1, 9)).toEqual([4, 5, 6, 7, 8])
  })
})
