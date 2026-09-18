import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'
import { useViewStore } from '../store/view-store'

/** The slide show: which slide is up, and what the room is looking at. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const at = () => useShowStore.getState().at

const press = (key: string) => {
  fireEvent.keyDown(window, { key })
}

const start = (id = 'show.start') => {
  act(() => {
    runCommand(id, {})
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
  useShowStore.setState({ at: null, blank: null, typed: '', count: 0 })
  useViewStore.setState({ leftPane: 'filmstrip', rulers: false })
})

describe('starting and ending', () => {
  it('starts at the first slide', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(4)
    })

    start()
    expect(at()).toBe(0)
    expect(screen.getByTestId('show')).toBeInTheDocument()
  })

  it('starts here when asked to', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(4)
    })

    start('show.start-here')
    expect(at()).toBe(4)
  })

  it('leaves the editor where it was', async () => {
    // "Present from here" means from here, not "and then leave me there".
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(2)
    })

    start('show.start-here')
    press('ArrowRight')
    press('Escape')

    expect(useDeckStore.getState().current).toBe(2)
  })

  it('ends on Escape', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('Escape')
    expect(at()).toBeNull()
    expect(screen.queryByTestId('show')).toBeNull()
  })

  it('is not offered for a deck that is not open', () => {
    expect(getCommand('show.start')?.isEnabled?.({})).toBe(false)
  })
})

describe('moving through the deck', () => {
  const forward = [' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter']
  const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']

  it.each(forward)('goes on with %s', async (key) => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press(key)
    expect(at()).toBe(1)
  })

  it.each(back)('goes back with %s', async (key) => {
    await openDeck('many-slides')
    render(<App />)
    start('show.start-here')
    act(() => {
      useShowStore.getState().go(3)
    })

    press(key)
    expect(at()).toBe(2)
  })

  it('goes to the ends', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('End')
    expect(at()).toBe(7)

    press('Home')
    expect(at()).toBe(0)
  })

  it('stops at the last slide rather than falling off it', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('End')
    press('ArrowRight')
    expect(at()).toBe(7)
  })

  it('stops at the first one going back', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('ArrowLeft')
    expect(at()).toBe(0)
  })

  it('advances on a click and goes back on the right button', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    fireEvent.pointerDown(screen.getByTestId('show'), { button: 0 })
    expect(at()).toBe(1)

    fireEvent.pointerDown(screen.getByTestId('show'), { button: 2 })
    expect(at()).toBe(0)
  })
})

describe('jumping to a number', () => {
  it('takes the digits and goes there on Enter', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('6')
    expect(screen.getByTestId('typed')).toHaveTextContent('6')

    press('Enter')
    // People count slides from one.
    expect(at()).toBe(5)
  })

  it('takes more than one digit', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('0')
    press('8')
    press('Enter')

    expect(at()).toBe(7)
  })

  it('advances on a bare Enter, with no number waiting', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('Enter')
    expect(at()).toBe(1)
  })

  it('ignores a number that names no slide', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('9')
    press('9')
    press('Enter')

    // Nothing typed is left over to confuse the next key either.
    expect(at()).toBe(0)
    expect(useShowStore.getState().typed).toBe('')
  })
})

describe('taking the screen away', () => {
  it('blanks to black and back', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('b')
    expect(screen.getByTestId('blank')).toBeInTheDocument()

    press('b')
    expect(screen.queryByTestId('blank')).toBeNull()
  })

  it('blanks to white', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    press('w')
    expect(screen.getByTestId('blank')).toHaveClass('bg-white')
  })

  it('keeps its place underneath', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()
    act(() => {
      useShowStore.getState().go(3)
    })

    press('b')
    press('b')
    expect(at()).toBe(3)
  })

  it('comes back the moment the show moves', async () => {
    // A blanked show that advanced invisibly leaves the presenter talking
    // about the wrong slide.
    await openDeck('many-slides')
    render(<App />)
    start()

    press('b')
    press('ArrowRight')

    expect(useShowStore.getState().blank).toBeNull()
    expect(at()).toBe(1)
  })
})

describe('what the room sees', () => {
  it('draws the slide the show is on, not the one being edited', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(0)
    })

    start()
    act(() => {
      useShowStore.getState().go(4)
    })

    const shown = screen.getByTestId('show')
    expect(shown.querySelector('[aria-label*="Slide 5"]')).not.toBeNull()
  })

  it('draws nothing of the editor over it', async () => {
    await openDeck('many-slides')
    render(<App />)
    start()

    // The show is the last thing in the tree and covers the window.
    expect(screen.getByTestId('show').className).toContain('fixed inset-0')
  })
})
