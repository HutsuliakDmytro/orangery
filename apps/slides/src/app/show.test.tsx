import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * Starting a show is asynchronous now: it asks for a window of its own first,
 * and only shows in this one when there is not going to be one.
 */
const start = async (id = 'show.start') => {
  await act(async () => {
    runCommand(id, {})
    await Promise.resolve()
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

    await start()
    expect(at()).toBe(0)
    expect(screen.getByTestId('show')).toBeInTheDocument()
  })

  it('starts here when asked to', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(4)
    })

    await start('show.start-here')
    expect(at()).toBe(4)
  })

  it('leaves the editor where it was', async () => {
    // "Present from here" means from here, not "and then leave me there".
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(2)
    })

    await start('show.start-here')
    press('ArrowRight')
    press('Escape')

    expect(useDeckStore.getState().current).toBe(2)
  })

  it('ends on Escape', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

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
    await start()

    press(key)
    expect(at()).toBe(1)
  })

  it.each(back)('goes back with %s', async (key) => {
    await openDeck('many-slides')
    render(<App />)
    await start('show.start-here')
    act(() => {
      useShowStore.getState().go(3)
    })

    press(key)
    expect(at()).toBe(2)
  })

  it('goes to the ends', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    press('End')
    expect(at()).toBe(7)

    press('Home')
    expect(at()).toBe(0)
  })

  it('stops at the last slide rather than falling off it', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    press('End')
    press('ArrowRight')
    expect(at()).toBe(7)
  })

  it('stops at the first one going back', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    press('ArrowLeft')
    expect(at()).toBe(0)
  })

  it('advances on a click and goes back on the right button', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

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
    await start()

    press('6')
    expect(screen.getByTestId('typed')).toHaveTextContent('6')

    press('Enter')
    // People count slides from one.
    expect(at()).toBe(5)
  })

  it('takes more than one digit', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    press('0')
    press('8')
    press('Enter')

    expect(at()).toBe(7)
  })

  it('advances on a bare Enter, with no number waiting', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    press('Enter')
    expect(at()).toBe(1)
  })

  it('ignores a number that names no slide', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

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
    await start()

    press('b')
    expect(screen.getByTestId('blank')).toBeInTheDocument()

    press('b')
    expect(screen.queryByTestId('blank')).toBeNull()
  })

  it('blanks to white', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    press('w')
    expect(screen.getByTestId('blank')).toHaveClass('bg-white')
  })

  it('keeps its place underneath', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()
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
    await start()

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

    await start()
    act(() => {
      useShowStore.getState().go(4)
    })

    const shown = screen.getByTestId('show')
    expect(shown.querySelector('[aria-label*="Slide 5"]')).not.toBeNull()
  })

  it('draws nothing of the editor over it', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()

    // The show is the last thing in the tree and covers the window.
    expect(screen.getByTestId('show').className).toContain('fixed inset-0')
  })
})

describe('the transition between slides', () => {
  it('keeps the slide being left on screen while the new one arrives', async () => {
    await openDeck('transitions')
    render(<App />)
    await start()

    // Slide 2 pushes, so moving to it animates.
    act(() => {
      press('ArrowRight')
    })

    expect(screen.getByTestId('leaving')).toBeInTheDocument()
    expect(screen.getByTestId('arriving')).toBeInTheDocument()
  })

  it('takes it away once the transition is over', async () => {
    await openDeck('transitions')
    render(<App />)
    await start()

    // Frozen only now: reading a deck goes through timers of its own, and
    // freezing them first never lets it finish — but the transition's timer
    // has to be one of the frozen ones to be advanced.
    vi.useFakeTimers()
    try {
      act(() => {
        press('ArrowRight')
      })
      expect(screen.getByTestId('leaving')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.queryByTestId('leaving')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('animates for as long as the file says', async () => {
    await openDeck('transitions')
    render(<App />)
    await start()
    act(() => {
      useShowStore.getState().go(4)
    })

    // The last slide states a second and a half in `p14:dur`.
    expect(screen.getByTestId('arriving').style.animation).toContain('1.5s')
  })

  it('uses the transition of the slide being arrived at', async () => {
    await openDeck('transitions')
    render(<App />)
    await start()
    act(() => {
      useShowStore.getState().go(2)
    })

    // Slide 3 wipes, whichever slide you came from.
    expect(screen.getByTestId('arriving').style.animation).toContain('orangery-wipe-in')
  })

  it('shows no transition at all for a deck that states none', async () => {
    await openDeck('many-slides')
    render(<App />)
    await start()
    act(() => {
      press('ArrowRight')
    })

    expect(screen.queryByTestId('leaving')).toBeNull()
  })

  it('does not animate the slide the show opens on', async () => {
    // Arriving at the first slide is not a transition from anywhere.
    await openDeck('transitions')
    render(<App />)
    await start()

    expect(screen.queryByTestId('leaving')).toBeNull()
  })
})

describe('a deck with animations', () => {
  it('holds back a shape until the press that brings it in', async () => {
    await openDeck('animations')
    render(<App />)
    await start()

    // The room has not been shown it yet; putting it there from the start is
    // giving away the point of the build.
    expect(screen.getByTestId('show').textContent).not.toContain('Fades in')

    press('ArrowRight')
    expect(screen.getByTestId('show').textContent).toContain('Fades in')
  })

  it('plays the effect rather than snapping the shape on', async () => {
    await openDeck('animations')
    render(<App />)
    await start()
    press('ArrowRight')

    const animated = [...screen.getByTestId('show').querySelectorAll('g')].filter((group) =>
      group.getAttribute('style')?.includes('animation-name'),
    )
    expect(animated).not.toHaveLength(0)
  })

  it('draws nothing the file hides', async () => {
    await openDeck('animations')
    render(<App />)
    await start()
    act(() => {
      useShowStore.getState().go(1)
    })

    const shown = screen.getByTestId('show')
    expect(shown.textContent).toContain('Shown')
    expect(shown.textContent).not.toContain('Not shown')
  })

  it('plays the slide’s builds before moving on from it', async () => {
    await openDeck('animations')
    render(<App />)
    await start()

    // The first press is the build; the slide is what comes after the last one.
    press('ArrowRight')
    expect(useShowStore.getState().at).toBe(0)

    press('ArrowRight')
    expect(useShowStore.getState().at).toBe(1)
  })

  it('takes a build back before it takes the slide back', async () => {
    await openDeck('animations')
    render(<App />)
    await start()
    press('ArrowRight')

    press('ArrowLeft')
    expect(useShowStore.getState().at).toBe(0)
    expect(screen.getByTestId('show').textContent).not.toContain('Fades in')
  })

  it('lands on a slide’s last build when it is reached backwards', async () => {
    await openDeck('animations')
    render(<App />)
    await start()
    act(() => {
      useShowStore.getState().go(1)
    })

    press('ArrowLeft')

    // The room has already seen all of it; replaying the build would be a lie
    // about what was said.
    expect(useShowStore.getState().at).toBe(0)
    expect(screen.getByTestId('show').textContent).toContain('Fades in')
  })
})

describe('film and sound', () => {
  it('shows the poster frame in the editor and no player over it', async () => {
    // A player there would be a control competing with selecting and moving the
    // thing it sits on.
    await openDeck('media')
    render(<App />)

    expect(screen.queryByTestId('media-video')).toBeNull()
  })

  it('puts a player over it once the show is running', async () => {
    await openDeck('media')
    render(<App />)
    await start()

    expect(screen.getByTestId('media-video')).toBeInTheDocument()
  })

  it('draws a sound as a sound', async () => {
    await openDeck('media')
    render(<App />)
    await start()
    act(() => {
      useShowStore.getState().go(1)
    })

    expect(screen.getByTestId('media-audio')).toBeInTheDocument()
    expect(screen.queryByTestId('media-video')).toBeNull()
  })

  it('waits to be asked where the file says it waits', async () => {
    await openDeck('media')
    render(<App />)
    await start()

    expect(screen.getByTestId<HTMLVideoElement>('media-video').autoplay).toBe(false)
  })

  it('does not advance the slide when the player is clicked', async () => {
    // A click anywhere in a show moves on, and a click on a film means play it.
    await openDeck('media')
    render(<App />)
    await start()

    fireEvent.pointerDown(screen.getByTestId('media-video'))
    expect(useShowStore.getState().at).toBe(0)
  })

  it('still advances on a click beside it', async () => {
    await openDeck('media')
    render(<App />)
    await start()

    fireEvent.pointerDown(screen.getByTestId('show'))
    expect(useShowStore.getState().at).toBe(1)
  })
})

describe('links in a show', () => {
  it('has none to click in the editor', async () => {
    // A link that stole the click would make a button impossible to move.
    await openDeck('links')
    render(<App />)

    expect(screen.queryByTestId('shape-link')).toBeNull()
  })

  it('goes to the slide a button points at', async () => {
    await openDeck('links')
    render(<App />)
    await start()

    const targets = screen.getAllByTestId('shape-link')
    const button = targets.at(-1)
    if (button === undefined) throw new Error('no link on the slide')

    fireEvent.pointerDown(button)
    expect(useShowStore.getState().at).toBe(2)
  })

  it('takes the jump that names no target', async () => {
    await openDeck('links')
    render(<App />)
    await start()
    act(() => {
      useShowStore.getState().go(1)
    })

    fireEvent.pointerDown(screen.getAllByTestId('shape-link')[0] as HTMLElement)
    expect(useShowStore.getState().at).toBe(2)
  })

  it('opens a web address away from the show', async () => {
    // A presentation that navigates away from itself has ended.
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)

    try {
      await openDeck('links')
      render(<App />)
      await start()

      // The filmstrip draws the same words behind the show.
      await userEvent.click(within(screen.getByTestId('show')).getByText('orangery.example'))

      expect(opened).toHaveBeenCalledWith(
        'https://orangery.example/deck',
        '_blank',
        'noopener,noreferrer',
      )
    } finally {
      opened.mockRestore()
    }
  })

  it('does not advance the slide when a link is clicked', async () => {
    await openDeck('links')
    render(<App />)
    await start()

    const targets = screen.getAllByTestId('shape-link')
    fireEvent.pointerDown(targets[0] as HTMLElement)

    // It went where the link pointed, not one slide on.
    expect(useShowStore.getState().at).not.toBe(1)
  })
})
