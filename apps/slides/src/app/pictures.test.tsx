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
import { useViewStore } from '../store/view-store'
import { usePicturesStore } from '../document/pictures-offer'

/**
 * The offer to shrink a deck's pictures on the way to disk.
 *
 * The arithmetic is tested where it lives. What is checked here is that the
 * question reaches the person, that each answer does what it says, and that
 * Cancel writes nothing — a deck that saved itself anyway would be the worst
 * possible reading of "cancel".
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const written: string[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string) => Promise.resolve(command === 'list_autosaves' ? [] : null),
}))

vi.mock('@orangery/platform', async (importActual) => ({
  ...(await importActual<object>()),
  isTauri: () => true,
}))

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  pickSavePath: () => Promise.resolve('/decks/big.pptx'),
  writeDeckFile: (path: string) => {
    written.push(path)
    return Promise.resolve({ path, backupPath: null })
  },
}))

/**
 * A PNG header claiming to be huge, padded out to `bytes`.
 *
 * The header is what the planner reads, and the padding is what makes the deck
 * heavy enough to be asked about — so between them they are the whole of a
 * twenty-megabyte photograph, without twenty megabytes of photograph.
 */
function hugePng(width: number, height: number, bytes: number): Uint8Array {
  const image = new Uint8Array(bytes)
  image.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  image.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  image.set([width >> 24, (width >> 16) & 255, (width >> 8) & 255, width & 255], 16)
  image.set([height >> 24, (height >> 16) & 255, (height >> 8) & 255, height & 255], 20)
  return image
}

async function openWithPicture(size: number) {
  const bytes = await readFile(join(FIXTURES, 'picture.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/big.pptx')
  })

  const pkg = useDeckStore.getState().open?.package
  const media =
    pkg === undefined ? undefined : [...pkg.parts.keys()].find((p) => p.startsWith('ppt/media/'))
  if (pkg === undefined || media === undefined) throw new Error('fixture has no picture')

  const part = pkg.parts.get(media)
  if (part === undefined) throw new Error('missing part')
  pkg.parts.set(media, { ...part, bytes: hugePng(6000, 4000, size) })
}

const offer = () => screen.queryByRole('alertdialog', { name: 'Large presentation' })

/**
 * Longer than the default, because the deck under test really is twenty-one
 * megabytes and really is zipped.
 *
 * The suite runs thirty files at once, and a second is not enough for that
 * under that load — which showed up as this file failing about one run in
 * three. A flaky test is worse than a slow one: it teaches people that a red
 * run means nothing.
 */
const SLOW = { timeout: 15_000 }

beforeEach(() => {
  written.length = 0
  usePicturesStore.getState().set(null)
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

describe('saving a deck that is not heavy', () => {
  it('asks nothing and just writes', async () => {
    await openWithPicture(1024)
    render(<App />)

    act(() => {
      runCommand('file.save', {})
    })

    await waitFor(() => {
      expect(written).toEqual(['/decks/big.pptx'])
    }, SLOW)
    expect(offer()).not.toBeInTheDocument()
  })
})

describe('saving a deck heavy with pictures', () => {
  it('offers to shrink them, and says by how much', async () => {
    await openWithPicture(21 * 1024 * 1024)
    render(<App />)

    act(() => {
      runCommand('file.save', {})
    })

    await waitFor(() => {
      expect(offer()).toBeInTheDocument()
    }, SLOW)
    // Nothing is on disk while the question is open.
    expect(written).toEqual([])
    expect(screen.getByText(/carries 21\.0 MB of pictures/u)).toBeInTheDocument()
    expect(screen.getByText(/would save about/u)).toBeInTheDocument()
  })

  it('writes the deck untouched when the answer is Save as is', async () => {
    await openWithPicture(21 * 1024 * 1024)
    render(<App />)
    act(() => {
      runCommand('file.save', {})
    })
    await waitFor(() => {
      expect(offer()).toBeInTheDocument()
    }, SLOW)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save as is' }))

    await waitFor(() => {
      expect(written).toEqual(['/decks/big.pptx'])
    }, SLOW)
  })

  it('writes nothing at all when the answer is Cancel', async () => {
    await openWithPicture(21 * 1024 * 1024)
    // Edited, so that "still unsaved" afterwards means something.
    act(() => {
      useDeckStore.getState().edit((slide) => {
        const shape = slide.shapes[0]
        return shape === undefined ? false : moveShape(shape, { x: 12700, y: 0 })
      })
    })
    render(<App />)
    act(() => {
      runCommand('file.save', {})
    })
    await waitFor(() => {
      expect(offer()).toBeInTheDocument()
    }, SLOW)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(offer()).not.toBeInTheDocument()
    }, SLOW)
    expect(written).toEqual([])
    // The deck is exactly as unsaved as it was, so closing still asks.
    expect(useDeckStore.getState().saved).toBe(false)
  })

  it('goes ahead when the answer is Shrink, even where nothing can decode', async () => {
    // jsdom has no canvas, so every picture comes back undecodable and is left
    // as it was — which is the behaviour a webview without a codec would give,
    // and the deck must still reach the disk.
    await openWithPicture(21 * 1024 * 1024)
    render(<App />)
    act(() => {
      runCommand('file.save', {})
    })
    await waitFor(() => {
      expect(offer()).toBeInTheDocument()
    }, SLOW)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Shrink and Save' }))

    await waitFor(() => {
      expect(written).toEqual(['/decks/big.pptx'])
    }, SLOW)
  })
})
