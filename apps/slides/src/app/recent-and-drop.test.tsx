import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
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
 * Decks arriving without a file dialog.
 *
 * Three ways in — the recent list, a file dropped on the window, and one the
 * OS hands over — and one thing they must all have in common: they go through
 * the same question about unsaved work as Open does.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

/** The app data directory the shell would have, as a map of file to contents. */
const appData = new Map<string, string>()

/** Handlers registered by the window, so a test can play the shell's part. */
const listeners = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler)
    return Promise.resolve(() => {
      listeners.delete(name)
    })
  },
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, string>) => {
    const key = `${args['directory'] ?? ''}/${args['name'] ?? ''}`
    if (command === 'write_autosave') {
      appData.set(key, args['contents'] ?? '')
      return Promise.resolve(null)
    }
    if (command === 'read_autosave') return Promise.resolve(appData.get(key) ?? null)
    if (command === 'list_autosaves') return Promise.resolve([])
    return Promise.resolve(null)
  },
}))

const picked = { path: '/decks/shapes.pptx' as string | null }
const opened: string[] = []

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  pickDeckPath: () => Promise.resolve(picked.path),
  pickSavePath: () => Promise.resolve('/decks/saved.pptx'),
  writeDeckFile: (path: string) => Promise.resolve({ path, backupPath: null }),
  readDeckFile: (path: string) => {
    opened.push(path)
    return readFile(join(FIXTURES, 'shapes.pptx')).then((bytes) => new Uint8Array(bytes))
  },
}))

/** Plays the shell handing the window a file. */
function deliver(name: string, payload: unknown) {
  const handler = listeners.get(name)
  if (handler === undefined) throw new Error(`nothing is listening for ${name}`)
  act(() => {
    handler({ payload })
  })
}

async function openThrough(command: string) {
  act(() => {
    runCommand(command, {})
  })
  await waitFor(() => {
    expect(useDeckStore.getState().open).not.toBeNull()
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

beforeEach(() => {
  // The real `isTauri` rather than a stand-in for it: the recent list is read
  // and written inside `@orangery/platform`, which asks the window directly, so
  // a mock of the package's own export would not reach it.
  ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}

  appData.clear()
  listeners.clear()
  opened.length = 0
  picked.path = '/decks/shapes.pptx'
  useGuardStore.getState().clear()
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

describe('the recent list', () => {
  it('is empty before anything has been opened', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: 'Recent' })).not.toBeInTheDocument()
  })

  it('remembers a deck that was opened', async () => {
    render(<App />)
    await openThrough('file.open')

    expect(await screen.findByRole('button', { name: 'Recent' })).toBeInTheDocument()
  })

  it('does not remember a file that failed to open', async () => {
    render(<App />)
    // A file that is not a deck: the store reports it and keeps what was open,
    // and a file nobody could open is not one to offer again.
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array([1, 2, 3]), '/decks/broken.pptx')
    })

    await waitFor(() => {
      expect(useDeckStore.getState().error).not.toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Recent' })).not.toBeInTheDocument()
  })

  it('opens the deck it names', async () => {
    render(<App />)
    await openThrough('file.open')
    act(() => {
      useDeckStore.getState().close()
    })

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Recent' }))
    await user.click(screen.getByRole('menuitem', { name: 'shapes.pptx' }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).not.toBeNull()
    })
  })

  it('asks about unsaved work first, like every other way in', async () => {
    render(<App />)
    await openThrough('file.open')
    edit()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Recent' }))
    await user.click(screen.getByRole('menuitem', { name: 'shapes.pptx' }))

    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument()
  })
})

describe('a file the window is handed', () => {
  it('opens a deck dropped onto it', async () => {
    render(<App />)
    deliver('tauri://drag-drop', { paths: ['/decks/dropped.pptx'] })

    await waitFor(() => {
      expect(opened).toEqual(['/decks/dropped.pptx'])
    })
  })

  it('ignores what is not a deck', async () => {
    render(<App />)
    deliver('tauri://drag-drop', { paths: ['/notes.txt', '/photo.png'] })

    await waitFor(() => {
      expect(useDeckStore.getState().open).toBeNull()
    })
    expect(opened).toEqual([])
  })

  it('takes the deck out of a mixed handful', async () => {
    render(<App />)
    deliver('tauri://drag-drop', { paths: ['/notes.txt', '/decks/talk.pptx'] })

    await waitFor(() => {
      expect(opened).toEqual(['/decks/talk.pptx'])
    })
  })

  it('opens one the OS hands over at launch', async () => {
    render(<App />)
    deliver('document:open-path', ['/decks/from-finder.pptx'])

    await waitFor(() => {
      expect(opened).toEqual(['/decks/from-finder.pptx'])
    })
  })

  it('asks before displacing unsaved work', async () => {
    render(<App />)
    await openThrough('file.open')
    edit()
    opened.length = 0

    deliver('tauri://drag-drop', { paths: ['/decks/dropped.pptx'] })

    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(opened).toEqual([])
  })
})
