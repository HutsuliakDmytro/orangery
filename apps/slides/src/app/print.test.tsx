import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'
import { useViewStore } from '../store/view-store'

/**
 * The deck on paper, which is also how it becomes a PDF.
 *
 * jsdom neither paginates nor prints, so what is checked is the layout that
 * goes to the page and the fact that the print was asked for. The pagination
 * arithmetic is tested on its own.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** Runs a print command with the system dialog stubbed out. */
function printing(id: string) {
  const asked = vi.spyOn(window, 'print').mockImplementation(() => undefined)
  const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 0
  })

  try {
    act(() => {
      runCommand(id, {})
    })
    return asked
  } finally {
    frames.mockRestore()
  }
}

const pages = () => screen.getAllByTestId('print-page')

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
  useViewStore.setState({ printLayout: 'slides', rulers: false, leftPane: 'filmstrip' })
})

describe('asking to print', () => {
  it('is not offered without a deck', () => {
    expect(getCommand('print.slides')?.isEnabled?.({})).toBe(false)
  })

  it('opens the system dialog, which is where a PDF comes from', async () => {
    await openDeck('many-slides')
    render(<App />)

    const asked = printing('print.slides')
    expect(asked).toHaveBeenCalledTimes(1)
    asked.mockRestore()
  })

  it('lays the deck out before it asks', async () => {
    // A dialog opened before the page is laid out prints the page before it.
    await openDeck('many-slides')
    render(<App />)

    const asked = printing('print.handout-6')
    expect(useViewStore.getState().printLayout).toBe('handout-6')
    expect(asked).toHaveBeenCalled()
    asked.mockRestore()
  })
})

describe('what goes on the page', () => {
  it('puts one slide on a page by default', async () => {
    await openDeck('many-slides')
    render(<App />)

    expect(pages()).toHaveLength(8)
    expect(within(pages()[0] as HTMLElement).getAllByTestId('print-slide')).toHaveLength(1)
  })

  it('fills a handout to the number it is named for', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useViewStore.getState().setPrintLayout('handout-3')
    })

    expect(pages()).toHaveLength(3)
    expect(within(pages()[0] as HTMLElement).getAllByTestId('print-slide')).toHaveLength(3)
  })

  it('leaves the last page short rather than dropping what is on it', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useViewStore.getState().setPrintLayout('handout-6')
    })

    expect(within(pages()[1] as HTMLElement).getAllByTestId('print-slide')).toHaveLength(2)
  })

  it('draws the slides with the same renderer as the canvas', async () => {
    await openDeck('many-slides')
    render(<App />)

    const first = within(pages()[0] as HTMLElement)
    expect(first.getByRole('img', { name: /Slide 1/u })).toBeInTheDocument()
  })
})

describe('notes on the page', () => {
  it('puts them under the slide when that is what was asked for', async () => {
    await openDeck('notes')
    render(<App />)
    act(() => {
      useViewStore.getState().setPrintLayout('notes')
    })

    expect(screen.getAllByTestId('print-notes')[0]?.textContent).not.toBe('')
  })

  it('leaves them off every other layout', async () => {
    await openDeck('notes')
    render(<App />)

    expect(screen.queryByTestId('print-notes')).toBeNull()
  })

  it('says nothing rather than something for a slide with no notes page', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useViewStore.getState().setPrintLayout('notes')
    })

    expect(screen.getAllByTestId('print-notes')[0]).toHaveTextContent('')
  })
})

describe('the page size', () => {
  it('follows the slide, so a wide deck is not two white bands on A4', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)

    expect(screen.getByTestId('print-view').querySelector('style')?.textContent).toContain(
      '13.33in 7.50in',
    )
  })

  it('is paper once more than one slide is on it', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)
    act(() => {
      useViewStore.getState().setPrintLayout('handout-2')
    })

    expect(screen.getByTestId('print-view').querySelector('style')?.textContent).toContain('A4')
  })
})
