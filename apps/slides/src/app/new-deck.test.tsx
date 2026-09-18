import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Starting a presentation from nothing.
 *
 * A new deck is a real package built in memory, so none of this needs the
 * shell: what is checked is that the command produces a deck the rest of the
 * window can already draw, and that the window says it belongs to no file yet.
 */

/** Runs New and waits for the deck, which has to be zipped before it arrives. */
async function createDeck() {
  act(() => {
    runCommand('file.new', {})
  })
  await waitFor(() => {
    expect(useDeckStore.getState().open).not.toBeNull()
  })
}

beforeEach(() => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

describe('New Presentation', () => {
  it('is offered whether or not there is a shell to save into', () => {
    expect(getCommand('file.new')?.isEnabled?.({})).toBe(true)
  })

  it('opens a deck with one slide on it', async () => {
    render(<App />)
    await createDeck()

    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Slide \d+$/u })).toHaveLength(1)
  })

  it('draws that slide on the canvas like any other', async () => {
    render(<App />)
    await createDeck()

    const canvas = within(screen.getByTestId('canvas'))
    expect(canvas.getByRole('img', { name: /^Slide/u })).toBeInTheDocument()
  })

  it('belongs to no file, and says so instead of naming one', async () => {
    render(<App />)
    await createDeck()

    expect(useDeckStore.getState().open?.path).toBeNull()
    expect(screen.getByText('Untitled Presentation')).toBeInTheDocument()
  })

  it('starts clean, so the dot does not claim changes nobody made', async () => {
    render(<App />)
    await createDeck()

    expect(useDeckStore.getState().saved).toBe(true)
    expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('offers the layouts a deck is built from', async () => {
    render(<App />)
    await createDeck()

    expect(useDeckStore.getState().open?.deck.layouts.size).toBe(6)
  })

  it('can be started from the welcome screen', async () => {
    render(<App />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New Presentation' }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).not.toBeNull()
    })
  })
})
