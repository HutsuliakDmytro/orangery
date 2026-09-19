import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPartText, parseXml } from '@orangery/ooxml-core'
import { EMU_PER_PIXEL, writeBodyProperties } from '@orangery/ooxml-drawingml'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Shrinking text that no longer fits the shape it is in.
 *
 * jsdom lays nothing out, so the measurement is stood in for: what is being
 * tested is what the app does with a measurement, and whether a browser can
 * measure text is not a question about this code. What is checked is the file.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

/** How much taller than its box the stood-in measurement says the text is. */
let overflow = 1

/**
 * The measurement, stood in for — as the browser would make it.
 *
 * Two elements, not one: the padded box, which is the shape, and the block of
 * paragraphs inside it, which is the words. Giving both the same height makes
 * the arithmetic degenerate and the test agree with whatever the code does —
 * it said for a while that a shape shrinks to its words, which no browser has
 * ever made it do. The box is the one that hides its overflow.
 */
const isBox = (element: HTMLElement) => element.style.overflow === 'hidden'

/** The first shape of `shapes.pptx` is an inch and a half tall, in pixels. */
const BOX = 1371600 / EMU_PER_PIXEL

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isBox(this) ? BOX : Math.round(BOX * overflow)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isBox(this) ? BOX : Math.round(BOX * overflow)
    },
  })

  overflow = 1
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Opens the fixture and asks its first shape to shrink its text. */
async function openShrinking() {
  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })

  // Through the same write the properties panel uses: asking to be shrunk is a
  // separate feature from being shrunk, and this is about the second.
  act(() => {
    useDeckStore.getState().edit((slide) => {
      const shape = slide.shapes[0]
      return shape?.text == null
        ? false
        : writeBodyProperties(shape.text.node, { autofit: 'shrink' })
    })
  })
}

const partText = () => {
  const { open } = useDeckStore.getState()
  const slide = open?.deck.slides[0]
  return open == null || slide === undefined ? '' : (getPartText(open.package, slide.path) ?? '')
}

describe('a shape that asked to be shrunk', () => {
  it('records a smaller scale when its text overflows', async () => {
    await openShrinking()
    overflow = 1.5

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    // Half again as tall as the box: about two thirds the size.
    expect(partText()).toContain('fontScale=')
  })

  it('leaves the file alone when the text fits', async () => {
    await openShrinking()
    // Asking to be shrunk is itself an edit, so the count is taken after it.
    const steps = useDeckStore.getState().undoStack.length
    overflow = 0.95

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    expect(partText()).not.toContain('fontScale')
    expect(useDeckStore.getState().undoStack).toHaveLength(steps)
  })

  it('settles rather than redrawing for as long as anybody looks at it', async () => {
    await openShrinking()
    overflow = 1.5

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    // Every write is an undoable step; a measurement that never agreed with
    // itself would fill the history with them.
    const steps = useDeckStore.getState().undoStack.length
    await act(async () => {
      await Promise.resolve()
    })
    expect(useDeckStore.getState().undoStack).toHaveLength(steps)
  })
})

describe('a shape that did not ask', () => {
  it('is left to overflow, because that is what it says it should do', async () => {
    const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
    })
    overflow = 3

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    expect(partText()).not.toContain('normAutofit')
    expect(parseXml(partText())).not.toHaveLength(0)
  })
})

describe('a shape that grows to its text', () => {
  /** Opens the fixture and asks its first shape to grow instead of shrink. */
  async function openGrowing() {
    const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
    })

    act(() => {
      useDeckStore.getState().edit((slide) => {
        const shape = slide.shapes[0]
        return shape?.text == null
          ? false
          : writeBodyProperties(shape.text.node, { autofit: 'shape' })
      })
    })
  }

  const firstHeight = () =>
    useDeckStore.getState().open?.deck.slides[0]?.shapes[0]?.transform?.height ?? 0

  it('takes the height its words need', async () => {
    await openGrowing()
    const before = firstHeight()
    // The stood-in measurement says the words are half again as tall as the box.
    overflow = 1.5

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    expect(firstHeight()).not.toBe(before)
    // In EMU, because that is what a shape's height is. The measurement is in
    // the pixels the text is laid out in, and writing one into the other
    // collapses the box to nothing.
    expect(firstHeight()).toBe(Math.round(BOX * 1.5) * EMU_PER_PIXEL)
  })

  it('leaves a shape whose words already fit', async () => {
    await openGrowing()
    const before = firstHeight()
    overflow = 0.4

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    // It grows and does not shrink, and the asymmetry is deliberate: shrinking
    // would fire on every deck with a roomy text box the moment it was opened,
    // and rewrite the geometry of a file nobody had touched. Growing only ever
    // follows words that stopped fitting, which is somebody's typing.
    expect(firstHeight()).toBe(before)
  })

  it('settles instead of nudging itself for ever', async () => {
    await openGrowing()
    overflow = 1.5

    await act(async () => {
      render(<App />)
      await Promise.resolve()
    })

    const steps = useDeckStore.getState().undoStack.length
    await act(async () => {
      await Promise.resolve()
    })
    expect(useDeckStore.getState().undoStack).toHaveLength(steps)
  })
})
