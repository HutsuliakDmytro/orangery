import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { readDeck, readPptxPackage } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Keeping the deck.
 *
 * The dialog and the write are the shell's, and there is no shell here, so they
 * are stood in for: what is checked is that the right bytes go to the right
 * path, and that the window stops claiming there is something unsaved.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const written: { path: string; bytes: Uint8Array }[] = []
let chosen: string | null = '/decks/chosen.pptx'

// Saving is a shell feature, so the app has to believe it is in one — and then
// the shell's own wiring runs too. The two calls it makes on mount are stood in
// for rather than let through to a bridge that is not there.
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  // Nothing here is about crash recovery, but the window looks for snapshots as
  // it mounts and a listing that is not a list is not what Rust ever answers.
  invoke: (command: string) => Promise.resolve(command === 'list_autosaves' ? [] : null),
}))

vi.mock('@orangery/platform', async (importActual) => ({
  ...(await importActual<object>()),
  isTauri: () => true,
}))

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  pickSavePath: () => Promise.resolve(chosen),
  writeDeckFile: (path: string, bytes: Uint8Array) => {
    written.push({ path, bytes })
    return Promise.resolve({ path, backupPath: null })
  },
}))

async function openDeck(name: string, path: string | null = `/decks/${name}.pptx`) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), path)
  })
}

/**
 * Runs a save and waits for it to land.
 *
 * Zipping a deck takes more than a tick, so a test that only flushed
 * microtasks would leave the write running into the next test and assert
 * against somebody else's file.
 */
const save = async (id = 'file.save') => {
  act(() => {
    runCommand(id, {})
  })
  await waitFor(() => {
    expect(written.length).toBeGreaterThan(0)
  })
}

/** The same, for the cases where nothing should reach the disk. */
const saveAndSettle = async (id = 'file.save') => {
  act(() => {
    runCommand(id, {})
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

/** Makes a change the deck did not have before. */
const edit = () => {
  act(() => {
    useDeckStore.getState().select(0)
    runCommand('insert.icon.star', {})
  })
}

beforeEach(() => {
  written.length = 0
  chosen = '/decks/chosen.pptx'
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
    saved: true,
  })
  useViewStore.setState({ rulers: false, leftPane: 'filmstrip' })
})

describe('saving', () => {
  it('is not offered without a deck', () => {
    expect(getCommand('file.save')?.isEnabled?.({})).toBe(false)
  })

  it('writes to the path the deck came from', async () => {
    await openDeck('empty')
    edit()
    await save()

    expect(written.map((one) => one.path)).toEqual(['/decks/empty.pptx'])
  })

  it('writes a deck that opens again', async () => {
    await openDeck('shapes')
    edit()
    await save()

    const bytes = written[0]?.bytes
    if (bytes === undefined) throw new Error('nothing was written')

    const reopened = readDeck(await readPptxPackage(bytes))
    expect(reopened.slides).toHaveLength(1)
  })

  it('writes what was edited, not what was opened', async () => {
    await openDeck('empty')
    const before = useDeckStore.getState().open?.deck.slides[0]?.shapes.length ?? 0
    edit()
    await save()

    const bytes = written[0]?.bytes
    if (bytes === undefined) throw new Error('nothing was written')

    const reopened = readDeck(await readPptxPackage(bytes))
    expect(reopened.slides[0]?.shapes.length).toBe(before + 1)
  })

  it('asks where to put a deck that has never been saved', async () => {
    await openDeck('empty', null)
    edit()
    await save()

    expect(written.map((one) => one.path)).toEqual(['/decks/chosen.pptx'])
    expect(useDeckStore.getState().open?.path).toBe('/decks/chosen.pptx')
  })

  it('writes nothing when the question is answered with nothing', async () => {
    chosen = null
    await openDeck('empty', null)
    edit()
    await saveAndSettle()

    expect(written).toEqual([])
    expect(useDeckStore.getState().saved).toBe(false)
  })
})

describe('saving somewhere else', () => {
  it('asks even when the deck has a path, and goes there after', async () => {
    await openDeck('empty')
    await save('file.save-as')

    expect(written.map((one) => one.path)).toEqual(['/decks/chosen.pptx'])
    expect(useDeckStore.getState().open?.path).toBe('/decks/chosen.pptx')
  })
})

describe('what the window says', () => {
  it('says nothing about a deck nobody has touched', async () => {
    await openDeck('empty')
    render(<App />)

    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('marks a deck that has been changed', async () => {
    await openDeck('empty')
    render(<App />)
    edit()

    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
  })

  it('stops marking it once it is saved', async () => {
    await openDeck('empty')
    render(<App />)
    edit()
    await save()

    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('marks it again after an undo, since the file now differs', async () => {
    await openDeck('empty')
    render(<App />)
    edit()
    await save()

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
  })
})
