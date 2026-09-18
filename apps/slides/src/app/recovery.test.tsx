import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { moveShape } from '@orangery/ooxml-presentation'
import { getPartText } from '@orangery/ooxml-core'
import { App } from './app'
import { AUTOSAVE_INTERVAL_MS, buildSnapshot, parseSnapshot } from '../document/autosave'
import type { Snapshot } from '../document/autosave'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Surviving a crash.
 *
 * The snapshot directory is the shell's, so it is stood in for by a map: what
 * is worth testing is that something is written when the person stops typing,
 * that it is offered when the app comes back, and that taking the offer puts
 * the work back on the deck it came off.
 */

const FIXTURES = joinPath(process.cwd(), 'tests/fixtures/pptx/synthetic')

/** The snapshot directories the shell would have on disk, by path. */
const autosaves = new Map<string, string>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, string>) => {
    switch (command) {
      // Stands in for the hash; all that matters is that it is stable.
      case 'document_key':
        return Promise.resolve(`key-${args['path'] ?? ''}`)
      case 'write_autosave':
        autosaves.set(args['directory'] ?? '', args['contents'] ?? '')
        return Promise.resolve(null)
      case 'read_autosave':
        return Promise.resolve(autosaves.get(args['directory'] ?? '') ?? null)
      case 'clear_autosave':
        autosaves.delete(args['directory'] ?? '')
        return Promise.resolve(null)
      case 'list_autosaves':
        return Promise.resolve([...autosaves.keys()].map((path) => path.split('/').pop()))
      default:
        return Promise.resolve(null)
    }
  },
}))

vi.mock('@orangery/platform', async (importActual) => ({
  ...(await importActual<object>()),
  isTauri: () => true,
}))

const missing = { path: null as string | null }

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  readDeckFile: (path: string) => {
    if (path === missing.path) return Promise.reject(new Error('no such file'))
    return readFile(joinPath(FIXTURES, path.split('/').pop() ?? '')).then(
      (bytes) => new Uint8Array(bytes),
    )
  },
}))

async function open(name: string) {
  const bytes = await readFile(joinPath(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** The open deck, or a failure that says the test never got one. */
function deck() {
  const open = useDeckStore.getState().open
  if (open === null) throw new Error('no deck is open')
  return open
}

function moveSomething() {
  act(() => {
    useDeckStore.getState().edit((slide) => {
      const shape = slide.shapes[0]
      return shape === undefined ? false : moveShape(shape, { x: 12700, y: 0 })
    })
  })
}

/**
 * Waits out the idle interval the autosave timer is waiting for.
 *
 * The clock is only taken over once the deck is open. Reading a `.pptx` is
 * asynchronous all the way down through the zip, and none of that resolves
 * while the timers it waits on are ours.
 */
async function pause(extra = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + extra)
  })
}

/** Everything after this point in a test happens on a clock we control. */
function takeTheClock() {
  vi.useFakeTimers()
}

/** The one snapshot on the pretend disk. */
function onlySnapshot(): Snapshot | null {
  const [contents] = [...autosaves.values()]
  return contents === undefined ? null : parseSnapshot(contents)
}

beforeEach(() => {
  autosaves.clear()
  missing.path = null
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('while a deck is being edited', () => {
  it('writes nothing until there is something to lose', async () => {
    await open('shapes')
    takeTheClock()
    render(<App />)
    await pause()

    expect(autosaves.size).toBe(0)
  })

  it('writes a snapshot once the person stops', async () => {
    await open('shapes')
    takeTheClock()
    render(<App />)
    moveSomething()
    await pause()

    const snapshot = onlySnapshot()
    const slide = useDeckStore.getState().open?.deck.slides[0]?.path
    expect(snapshot?.path).toBe('/decks/shapes.pptx')
    expect(snapshot?.parts.map((part) => part.path)).toEqual([slide])
  })

  it('writes nothing while the change is still coming', async () => {
    await open('shapes')
    takeTheClock()
    render(<App />)
    moveSomething()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 100)
    })
    // The timer restarts on the second edit, so the first one never reaches it.
    moveSomething()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(autosaves.size).toBe(0)
  })

  it('throws the snapshot away once the deck is on disk', async () => {
    await open('shapes')
    takeTheClock()
    render(<App />)
    moveSomething()
    await pause()
    expect(autosaves.size).toBe(1)

    act(() => {
      useDeckStore.getState().markSaved('/decks/shapes.pptx')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(autosaves.size).toBe(0)
  })
})

describe('when the app comes back', () => {
  /**
   * Leaves behind what a session that died mid-edit would have left.
   *
   * The snapshot is built and put where the timer would have put it, rather
   * than waited for: nothing here is about the timer, and taking over the clock
   * would stop the zip the recovery has to read.
   */
  async function leaveASnapshotBehind(name = 'shapes') {
    await open(name)
    moveSomething()

    const snapshot = buildSnapshot(
      `/decks/${name}.pptx`,
      deck().package,
      useDeckStore.getState().dirtyParts,
    )
    autosaves.set('/app-data/autosave/key-dead-session', JSON.stringify(snapshot))

    act(() => {
      useDeckStore.getState().close()
    })
    return snapshot
  }

  it('offers the work rather than opening it unasked', async () => {
    await leaveASnapshotBehind()
    render(<App />)

    await waitFor(() => {
      expect(
        screen.getByText('A presentation was not saved before Orangery Slides last closed.'),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument()
    // Nothing was opened behind the banner.
    expect(useDeckStore.getState().open).toBeNull()
  })

  it('puts the edit back onto the file it came off', async () => {
    const snapshot = await leaveASnapshotBehind()
    render(<App />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Recover' }))

    await waitFor(() => {
      expect(useDeckStore.getState().open).not.toBeNull()
    })

    const part = snapshot.parts[0]
    if (part === undefined) throw new Error('the snapshot carried nothing')

    expect(getPartText(deck().package, part.path)).toBe(part.text)
    // Recovered work has never been in a file.
    expect(useDeckStore.getState().saved).toBe(false)
  })

  it('stops offering what was recovered', async () => {
    await leaveASnapshotBehind()
    render(<App />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Recover' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Recover' })).not.toBeInTheDocument()
    })
    expect(autosaves.size).toBe(0)
  })

  it('forgets work the person does not want back', async () => {
    await leaveASnapshotBehind()
    render(<App />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() => {
      expect(autosaves.size).toBe(0)
    })
    expect(useDeckStore.getState().open).toBeNull()
  })

  it('says so when the file the work belongs to has moved', async () => {
    await leaveASnapshotBehind()
    missing.path = '/decks/shapes.pptx'
    render(<App />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Recover' }))

    await waitFor(() => {
      expect(useDeckStore.getState().error).toMatch(/no longer where it was/u)
    })
    // The offer stays: the file may come back, and discarding it is the
    // person's decision to make, not ours.
    expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument()
  })
})
