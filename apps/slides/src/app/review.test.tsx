import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  duplicateSlide,
  flatten,
  readDeck,
  readPptxPackage,
  removeSlide,
  saveDeck,
  setShapeText,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import type { Deck } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { App } from './app'
import { useReviewStore } from '../document/review'
import { useDeckStore } from '../store/deck-store'

/**
 * Reviewing a copy somebody sent back.
 *
 * The file dialog belongs to the shell, so the other deck is handed to the
 * store directly: what is being tested is what the panel offers and what
 * accepting one does to the open deck.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

beforeEach(async () => {
  useDeckStore.getState().close()
  useReviewStore.getState().end()

  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })
})

/** The same deck with its first shape rewritten, as somebody would send back. */
async function theirVersion(): Promise<{ deck: Deck; pkg: OoxmlPackage }> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
  const deck = readDeck(pkg)
  const shape = flatten(deck.slides[0]?.shapes ?? [])[0]
  if (shape === undefined) throw new Error('fixture has no shapes')

  setShapeText(shape, [{ text: 'Their wording' }])
  for (const slide of deck.slides) writeSlidePart(pkg, slide)

  const reopened = await readPptxPackage(await saveDeck(pkg))
  return { deck: readDeck(reopened), pkg: reopened }
}

const start = async () => {
  const theirs = await theirVersion()
  act(() => {
    useReviewStore.getState().start(theirs.deck, theirs.pkg)
  })
}

const firstText = () => {
  const shape = flatten(useDeckStore.getState().open?.deck.slides[0]?.shapes ?? [])[0]
  return shape?.text == null ? '' : textOfBody(shape.text)
}

describe('the review panel', () => {
  it('lists what the other deck says differently', async () => {
    render(<App />)
    await start()

    expect(screen.getByLabelText('Review')).toBeInTheDocument()
    expect(screen.getByText(/Their wording/u)).toBeInTheDocument()
  })

  it('says so when the two are the same', async () => {
    render(<App />)
    const same = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    act(() => {
      useReviewStore.getState().start(readDeck(same), same)
    })

    expect(screen.getByText('The two decks are the same.')).toBeInTheDocument()
  })
})

describe('deciding about a change', () => {
  it('takes it into the deck when it is accepted', async () => {
    const user = userEvent.setup()
    render(<App />)
    await start()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))

    expect(firstText()).toBe('Their wording')
    expect(screen.getByText('Every change has been dealt with.')).toBeInTheDocument()
  })

  it('leaves the deck alone when it is rejected', async () => {
    const user = userEvent.setup()
    render(<App />)
    await start()
    const before = firstText()

    await user.click(screen.getByRole('button', { name: 'Reject change 1' }))

    expect(firstText()).toBe(before)
    expect(screen.getByText('Every change has been dealt with.')).toBeInTheDocument()
  })

  it('is one step to undo', async () => {
    const user = userEvent.setup()
    render(<App />)
    await start()
    const before = firstText()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(firstText()).toBe(before)
  })

  it('ends when it is closed, leaving what was accepted', async () => {
    const user = userEvent.setup()
    render(<App />)
    await start()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    await user.click(screen.getByRole('button', { name: 'End review' }))

    expect(screen.queryByLabelText('Review')).not.toBeInTheDocument()
    expect(firstText()).toBe('Their wording')
  })
})

/**
 * A change about a whole slide.
 *
 * The one the panel used to show and refuse. It is taken from the package
 * rather than from the model — a slide is a part with its own relationships —
 * so the assertions look at what the deck holds afterwards, not only at what
 * the panel says.
 */
describe('a whole slide', () => {
  /** Their version of a deck with several slides: one of them copied to the front. */
  async function theirLongerDeck() {
    const bytes = await readFile(join(FIXTURES, 'many-slides.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/many.pptx')
    })

    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    duplicateSlide(pkg, 0)
    const reopened = await readPptxPackage(await saveDeck(pkg))

    act(() => {
      useReviewStore.getState().start(readDeck(reopened), reopened)
    })
  }

  const slideCount = () => useDeckStore.getState().open?.deck.slides.length ?? 0

  it('is offered, not only shown', async () => {
    render(<App />)
    await theirLongerDeck()

    expect(screen.getByText(/Slide 2 added/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept change 1' })).toBeInTheDocument()
  })

  it('comes into the deck when it is accepted', async () => {
    const user = userEvent.setup()
    render(<App />)
    await theirLongerDeck()
    const before = slideCount()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))

    expect(slideCount()).toBe(before + 1)
    expect(screen.getByText('Every change has been dealt with.')).toBeInTheDocument()
  })

  it('is one step to undo', async () => {
    const user = userEvent.setup()
    render(<App />)
    await theirLongerDeck()
    const before = slideCount()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(slideCount()).toBe(before)
  })

  it('takes a slide they deleted out of this deck', async () => {
    const user = userEvent.setup()
    render(<App />)

    const bytes = await readFile(join(FIXTURES, 'many-slides.pptx'))
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/many.pptx')
    })

    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    removeSlide(pkg, 2)
    const reopened = await readPptxPackage(await saveDeck(pkg))
    act(() => {
      useReviewStore.getState().start(readDeck(reopened), reopened)
    })

    const before = slideCount()
    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))

    expect(slideCount()).toBe(before - 1)
  })
})
