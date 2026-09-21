import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { moveShape } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useGuardStore } from '../document/unsaved'
import { useViewStore } from '../store/view-store'

/**
 * Losing nothing without being asked.
 *
 * New, Open, Close and the window itself all take the deck off the screen, and
 * each of them used to take whatever was unsaved with it. What is checked here
 * is the question, the three answers, and that a cancelled Save leaves the deck
 * where it was rather than going ahead anyway.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const confirmed: string[] = []
let chosen: string | null = '/decks/chosen.pptx'
const cleared: string[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, string>) => {
    if (command === 'confirm_close') confirmed.push('closed')
    if (command === 'clear_autosave') cleared.push(args['directory'] ?? '')
    if (command === 'list_autosaves') return Promise.resolve([])
    return Promise.resolve(null)
  },
}))

vi.mock('@orangery/platform', async (importActual) => ({
  ...(await importActual<object>()),
  isTauri: () => true,
}))

const written: string[] = []

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  pickSavePath: () => Promise.resolve(chosen),
  pickDeckPath: () => Promise.resolve('/decks/other.pptx'),
  writeDeckFile: (path: string) => {
    written.push(path)
    return Promise.resolve({ path, backupPath: null })
  },
  readDeckFile: () =>
    readFile(join(FIXTURES, 'many-slides.pptx')).then((bytes) => new Uint8Array(bytes)),
}))

async function openDeck(name = 'shapes') {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

function edit() {
  act(() => {
    useDeckStore.getState().edit((slide) => {
      const shape = slide.shapes[0]
      return shape === undefined ? false : moveShape(shape, { x: 12700, y: 0 })
    })
  })
}

const prompt = () => screen.queryByRole('alertdialog', { name: 'Unsaved changes' })

beforeEach(() => {
  confirmed.length = 0
  written.length = 0
  cleared.length = 0
  chosen = '/decks/chosen.pptx'
  useGuardStore.getState().clear()
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

describe('with nothing unsaved', () => {
  it('closes the deck without a word', async () => {
    await openDeck()
    render(<App />)

    act(() => {
      runCommand('file.close', {})
    })

    expect(prompt()).not.toBeInTheDocument()
    expect(useDeckStore.getState().open).toBeNull()
  })

  it('lets the window go', async () => {
    await openDeck()
    render(<App />)

    act(() => {
      runCommand('file.new', {})
    })
    await waitFor(() => {
      expect(useDeckStore.getState().open?.path).toBeNull()
    })
  })
})

describe('with unsaved changes', () => {
  it('asks before closing the deck', async () => {
    await openDeck()
    edit()
    render(<App />)

    act(() => {
      runCommand('file.close', {})
    })

    expect(prompt()).toBeInTheDocument()
    // Nothing has happened yet: the deck is still there behind the prompt.
    expect(useDeckStore.getState().open).not.toBeNull()
  })

  it('names the deck it is asking about', async () => {
    await openDeck()
    edit()
    render(<App />)

    act(() => {
      runCommand('file.close', {})
    })

    // Scoped to the dialog: the window title says the same name behind it.
    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' })
    expect(within(dialog).getByText(/shapes\.pptx/u)).toBeInTheDocument()
  })

  it('leaves everything alone when the answer is Cancel', async () => {
    await openDeck()
    edit()
    render(<App />)
    act(() => {
      runCommand('file.close', {})
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(prompt()).not.toBeInTheDocument()
    })
    expect(useDeckStore.getState().open).not.toBeNull()
    expect(useDeckStore.getState().saved).toBe(false)
  })

  it('goes ahead when the answer is Don’t Save', async () => {
    await openDeck()
    edit()
    render(<App />)
    act(() => {
      runCommand('file.close', {})
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: "Don't Save" }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).toBeNull()
    })
    // The snapshot goes with it: offering the work back at the next launch is
    // the opposite of what was just chosen.
    expect(cleared.length).toBeGreaterThan(0)
  })

  it('saves first when the answer is Save, and then goes ahead', async () => {
    await openDeck()
    edit()
    render(<App />)
    act(() => {
      runCommand('file.close', {})
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).toBeNull()
    })
    expect(written).toEqual(['/decks/shapes.pptx'])
  })

  it('stays put when the save itself is called off', async () => {
    await openDeck('shapes')
    // A deck with no path has to be asked where to go, and that dialog can be
    // dismissed — at which point the work is still unsaved and closing would
    // throw away exactly what the person asked to keep.
    act(() => {
      useDeckStore.setState({ open: { ...useDeckStore.getState().open, path: null } as never })
    })
    edit()
    chosen = null
    render(<App />)
    act(() => {
      runCommand('file.close', {})
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(prompt()).not.toBeInTheDocument()
    })
    expect(useDeckStore.getState().open).not.toBeNull()
    expect(written).toEqual([])
  })

  it('asks before a new deck replaces this one', async () => {
    await openDeck()
    edit()
    render(<App />)

    act(() => {
      runCommand('file.new', {})
    })

    expect(prompt()).toBeInTheDocument()
    expect(useDeckStore.getState().open?.path).toBe('/decks/shapes.pptx')
  })

  it('asks before another file replaces this one', async () => {
    await openDeck()
    edit()
    render(<App />)

    act(() => {
      runCommand('file.open', {})
    })

    expect(prompt()).toBeInTheDocument()
    expect(useDeckStore.getState().open?.path).toBe('/decks/shapes.pptx')
  })
})
