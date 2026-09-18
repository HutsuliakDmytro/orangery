import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addSlide,
  createDeck,
  flatten,
  moveShape,
  readDeck,
  readPptxPackage,
  saveDeck,
  setShapeText,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import { Filmstrip } from '../components/filmstrip'
import { useDeckStore } from '../store/deck-store'

/**
 * What a deck of three hundred slides costs.
 *
 * The budgets are deliberately loose — several times what the work actually
 * takes on a laptop — because a shared CI runner is not a benchmark and a test
 * that fails when the machine is busy teaches people to ignore it. What they
 * catch is the thing worth catching: an edit going from constant cost to the
 * cost of the whole deck, which is an order of magnitude and does not hide
 * inside a loose budget.
 *
 * Frames per second and memory are not here. They need a window, a compositor
 * and a real display, and they are in `docs/qa-checklist.md` where a person
 * with all three can answer them.
 */

const SLIDES = 300

/** Builds the deck off the clock; the building is not what is being measured. */
async function bigDeck(): Promise<Uint8Array> {
  const pkg = await readPptxPackage(await createDeck())

  for (let index = 1; index < SLIDES; index += 1) {
    const deck = readDeck(pkg)
    const layout = [...deck.layouts.values()][1]
    if (layout === undefined) break
    addSlide(pkg, deck, layout, index - 1)
  }

  const deck = readDeck(pkg)
  for (const [index, slide] of deck.slides.entries()) {
    const shape = flatten(slide.shapes)[0]
    if (shape !== undefined) setShapeText(shape, [{ text: `Slide ${String(index + 1)}` }])
    writeSlidePart(pkg, slide)
  }

  return saveDeck(pkg)
}

async function took(work: () => Promise<void> | void): Promise<number> {
  const started = performance.now()
  await work()
  return performance.now() - started
}

function nudge() {
  useDeckStore.getState().edit((slide) => {
    const shape = flatten(slide.shapes)[0]
    return shape === undefined ? false : moveShape(shape, { x: 12700, y: 0 })
  })
}

describe('three hundred slides', () => {
  it('opens, edits and saves within budget', async () => {
    const bytes = await bigDeck()

    const opening = await took(async () => {
      await useDeckStore.getState().load(bytes, '/decks/big.pptx')
    })
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(SLIDES)

    // Reading is linear in the deck and always will be; this is the budget the
    // plan asks for, with the rendering left out because there is none here.
    expect(opening).toBeLessThan(2_000)

    // The one that matters. Twenty edits on a three-hundred-slide deck must
    // cost about what twenty edits on a three-slide deck cost: an edit touches
    // one slide, so it may not pay for the rest of them.
    const editing = await took(() => {
      for (let n = 0; n < 20; n += 1) nudge()
    })
    expect(editing).toBeLessThan(500)

    const undoing = await took(() => {
      for (let n = 0; n < 20; n += 1) useDeckStore.getState().undo()
    })
    expect(undoing).toBeLessThan(500)

    const open = useDeckStore.getState().open
    const saving = await took(() => (open === null ? undefined : saveDeck(open.package).then()))
    expect(saving).toBeLessThan(2_000)
  }, 120_000)

  it('leaves the deck correct after all that', () => {
    const deck = useDeckStore.getState().open?.deck
    const first = deck?.slides[0]
    const shape = first === undefined ? undefined : flatten(first.shapes)[0]

    // Twenty nudges and twenty undos: back where it started, and still a deck.
    expect(deck?.slides).toHaveLength(SLIDES)
    expect(shape?.transform).not.toBeUndefined()
  })
})

/**
 * An observer that says the first few elements are on screen and no others.
 *
 * jsdom has none, and without one every thumbnail draws — which is the right
 * answer where nothing can be observed and the wrong one for measuring what
 * observing saves.
 */
function stubObserver(visible: number): void {
  let seen = 0

  class Stub {
    constructor(private readonly notify: (entries: { isIntersecting: boolean }[]) => void) {}

    observe(): void {
      const on = seen < visible
      seen += 1
      this.notify([{ isIntersecting: on }])
    }

    disconnect(): void {
      // Nothing to stop: this one reports once and never changes its mind.
    }
  }

  ;(globalThis as Record<string, unknown>)['IntersectionObserver'] = Stub
}

describe('the filmstrip of three hundred slides', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['IntersectionObserver']
  })

  it('draws the ones near the window and not the rest', () => {
    // Measured before this was written: three hundred thumbnails came to six
    // and a half thousand elements before anybody had scrolled.
    stubObserver(12)
    const { container } = render(<Filmstrip />)

    expect(container.querySelectorAll('svg')).toHaveLength(12)
    expect(container.querySelectorAll('*').length).toBeLessThan(3_000)
  })

  it('keeps a place for every slide, drawn or not', () => {
    stubObserver(12)
    const { container } = render(<Filmstrip />)

    // Otherwise the strip would be a twelfth of its length and the scrollbar
    // would jump under the pointer as thumbnails arrived.
    expect(container.querySelectorAll('li')).toHaveLength(SLIDES)
  })

  it('draws every one where nothing can say what is on screen', () => {
    // No observer: the choice is between drawing everything and drawing
    // nothing, and only one of those shows a deck.
    const { container } = render(<Filmstrip />)
    expect(container.querySelectorAll('svg')).toHaveLength(SLIDES)
  })
})
