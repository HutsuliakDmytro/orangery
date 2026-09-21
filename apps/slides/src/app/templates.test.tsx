import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { flatten } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useGuardStore } from '../document/unsaved'
import { useViewStore } from '../store/view-store'

/**
 * Choosing what a deck starts as.
 *
 * The building is tested where the templates are; what is checked here is that
 * the chooser reaches it, and that choosing a template is still a way of
 * replacing the deck on screen — so it asks the same question as every other.
 */

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string) => Promise.resolve(command === 'list_autosaves' ? [] : null),
}))

function chooser() {
  return screen.queryByRole('dialog', { name: 'New Presentation' })
}

beforeEach(() => {
  useGuardStore.getState().clear()
  useDeckStore.getState().close()
  useViewStore.setState({
    choosingTemplate: false,
    panels: { filmstrip: true, properties: true, notes: true },
  })
})

describe('the template chooser', () => {
  it('is not up until it is asked for', () => {
    render(<App />)
    expect(chooser()).not.toBeInTheDocument()
  })

  it('offers every template, with what each is for', async () => {
    render(<App />)
    act(() => {
      runCommand('file.new-from-template', {})
    })

    expect(await screen.findByRole('button', { name: /Pitch/u })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Thesis defence/u })).toBeInTheDocument()
    expect(screen.getByText('Problem, solution, market, ask.')).toBeInTheDocument()
  })

  it('builds the deck that was chosen', async () => {
    render(<App />)
    act(() => {
      runCommand('file.new-from-template', {})
    })

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Pitch/u }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).not.toBeNull()
    })

    const deck = useDeckStore.getState().open?.deck
    const first = deck?.slides[0]
    const title = first === undefined ? undefined : flatten(first.shapes)[0]
    expect(deck?.slides).toHaveLength(6)
    expect(title?.text == null ? '' : textOfBody(title.text)).toBe('Company')
  })

  it('leaves the new deck belonging to no file', async () => {
    render(<App />)
    act(() => {
      runCommand('file.new-from-template', {})
    })

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Blank/u }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).not.toBeNull()
    })
    expect(useDeckStore.getState().open?.path).toBeNull()
    expect(useDeckStore.getState().saved).toBe(true)
  })

  it('asks about unsaved work only once a template is chosen', async () => {
    render(<App />)
    act(() => {
      runCommand('file.new', {})
    })
    await waitFor(() => {
      expect(useDeckStore.getState().open).not.toBeNull()
    })
    act(() => {
      useDeckStore.setState({ saved: false })
    })

    act(() => {
      runCommand('file.new-from-template', {})
    })
    // Still choosing: asking now and then being told "never mind" would be a
    // question about nothing.
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Lecture/u }))

    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument()
  })
})
