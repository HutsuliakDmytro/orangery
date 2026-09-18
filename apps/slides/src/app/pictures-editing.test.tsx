import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import userEvent from '@testing-library/user-event'
import { getPartText } from '@orangery/ooxml-core'
import { flatten, writeCrop } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Cropping a picture, and the ways one arrives on a slide.
 *
 * The SVG has no rectangle in jsdom, so one is stood in for; what is being
 * tested is what the drag means, not what the browser measures.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')
const DRAWN = 1219.2

const client = (point: { x: number; y: number }) => {
  const size = useDeckStore.getState().open?.deck.slideSize ?? { width: 1, height: 1 }
  return { clientX: point.x / (size.width / DRAWN), clientY: point.y / (size.height / DRAWN) }
}

const listeners = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler)
    return Promise.resolve(() => listeners.delete(name))
  },
  emit: () => Promise.resolve(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string) => Promise.resolve(command === 'list_autosaves' ? [] : null),
}))

vi.mock('@orangery/platform', async (importActual) => ({
  ...(await importActual<object>()),
  isTauri: () => true,
}))

const dropped: string[] = []

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  readFileBytes: (path: string) => {
    dropped.push(path)
    // A one-pixel PNG is a real picture as far as the package is concerned.
    return Promise.resolve(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    )
  },
}))

beforeEach(async () => {
  dropped.length = 0
  listeners.clear()
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: DRAWN,
    height: DRAWN,
    right: DRAWN,
    bottom: DRAWN,
    toJSON: () => ({}),
  })

  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  const bytes = await readFile(join(FIXTURES, 'picture.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/picture.pptx')
  })
})

const picture = () =>
  flatten(useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []).find(
    (shape) => shape.picture !== null,
  )

function enterCrop() {
  const found = picture()
  if (found === undefined) throw new Error('fixture has no picture')

  const canvas = within(screen.getByTestId('canvas'))
  const target = canvas.getAllByRole('button', {
    name: found.name === '' ? 'Shape' : found.name,
  })[0]
  if (target === undefined) throw new Error('the picture has no hit target')

  fireEvent.pointerDown(target)
  fireEvent.dblClick(target)
  return found
}

describe('cropping', () => {
  it('starts on a double click, which on a picture can mean nothing else', () => {
    render(<App />)
    const found = enterCrop()

    expect(useDeckStore.getState().cropping).toBe(found.id)
    // And the handles say so: they crop rather than resize.
    expect(screen.getByRole('button', { name: 'Crop nw' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resize nw' })).not.toBeInTheDocument()
  })

  it('offers no way to turn the picture while cropping', () => {
    render(<App />)
    enterCrop()
    expect(screen.queryByRole('button', { name: 'Rotate' })).not.toBeInTheDocument()
  })

  it('takes a side away rather than resizing the frame', () => {
    render(<App />)
    const found = enterCrop()
    const box = found.transform
    if (box == null) throw new Error('picture has no transform')

    const handle = screen.getByRole('button', { name: 'Crop w' })
    fireEvent.pointerDown(handle, client({ x: box.x, y: box.y + box.height / 2 }))
    fireEvent.pointerMove(window, client({ x: box.x + box.width / 4, y: box.y + box.height / 2 }))
    fireEvent.pointerUp(window, client({ x: box.x + box.width / 4, y: box.y + box.height / 2 }))

    const after = picture()
    expect(after?.picture?.crop.left).toBeCloseTo(0.25, 2)
    // The frame stayed exactly where it was; less of the picture shows in it.
    expect(after?.transform?.x).toBe(box.x)
    expect(after?.transform?.width).toBe(box.width)
  })

  it('is left on Escape', () => {
    render(<App />)
    enterCrop()

    act(() => {
      runCommand('edit.leave-crop', {})
    })

    expect(useDeckStore.getState().cropping).toBeNull()
  })
})

describe('a picture dropped on the window', () => {
  it('goes onto the slide rather than opening anything', async () => {
    render(<App />)
    const before = useDeckStore.getState().open?.deck.slides[0]?.shapes.length ?? 0

    const handler = listeners.get('tauri://drag-drop')
    if (handler === undefined) throw new Error('nothing is listening for a drop')
    await act(async () => {
      handler({ payload: { paths: ['/photos/holiday.png'] } })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(useDeckStore.getState().open?.deck.slides[0]?.shapes.length).toBe(before + 1)
    })
    expect(dropped).toEqual(['/photos/holiday.png'])
  })

  it('leaves a file that is neither a deck nor a picture alone', async () => {
    render(<App />)
    const before = useDeckStore.getState().open?.deck.slides[0]?.shapes.length ?? 0

    const handler = listeners.get('tauri://drag-drop')
    if (handler === undefined) throw new Error('nothing is listening for a drop')
    await act(async () => {
      handler({ payload: { paths: ['/notes.txt'] } })
      await Promise.resolve()
    })

    expect(useDeckStore.getState().open?.deck.slides[0]?.shapes.length).toBe(before)
    expect(dropped).toEqual([])
  })
})

describe('the picture panel', () => {
  const select = () => {
    const found = picture()
    if (found === undefined) throw new Error('fixture has no picture')
    act(() => {
      useDeckStore.getState().selectShapes([found.id])
    })
  }

  const partText = () => {
    const { open, current } = useDeckStore.getState()
    const slide = open?.deck.slides[current]
    return open == null || slide === undefined ? '' : (getPartText(open.package, slide.path) ?? '')
  }

  it('makes the picture see-through, and draws it that way', async () => {
    render(<App />)
    select()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Opacity 50%' }))

    expect(picture()?.picture?.opacity).toBeCloseTo(0.5, 2)
    expect(partText()).toContain('alphaModFix')
    // Before this, a picture made see-through was drawn solid over the words.
    expect(document.querySelector('image[opacity="0.5"]')).not.toBeNull()
  })

  it('writes nothing at all for a solid picture', async () => {
    render(<App />)
    select()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Opacity 25%' }))
    await user.click(screen.getByRole('button', { name: 'Opacity solid' }))

    // Opaque is what a picture that says nothing already is.
    expect(partText()).not.toContain('alphaModFix')
  })

  it('resets the crop and the transparency, and leaves the frame alone', async () => {
    render(<App />)
    select()
    const before = picture()?.transform

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Opacity 25%' }))
    act(() => {
      useDeckStore.getState().edit((slide) => {
        const found = flatten(slide.shapes).find((shape) => shape.picture !== null)
        return found === undefined
          ? false
          : writeCrop(found, { left: 0.2, top: 0, right: 0, bottom: 0 })
      })
    })

    await user.click(screen.getByRole('button', { name: 'Reset picture' }))

    expect(picture()?.picture?.crop.left).toBe(0)
    expect(picture()?.picture?.opacity).toBe(1)
    // The frame is where somebody put it; resetting that is a different undo.
    expect(picture()?.transform?.x).toBe(before?.x)
  })
})
