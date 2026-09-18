import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  flatten,
  readDeck,
  readPptxPackage,
  saveDeck,
  setShapeText,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import type { Deck } from '@orangery/ooxml-presentation'
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
async function theirVersion(): Promise<Deck> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
  const deck = readDeck(pkg)
  const shape = flatten(deck.slides[0]?.shapes ?? [])[0]
  if (shape === undefined) throw new Error('fixture has no shapes')

  setShapeText(shape, [{ text: 'Their wording' }])
  for (const slide of deck.slides) writeSlidePart(pkg, slide)

  return readDeck(await readPptxPackage(await saveDeck(pkg)))
}

const start = async () => {
  const theirs = await theirVersion()
  act(() => {
    useReviewStore.getState().start(theirs)
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
    const same = readDeck(await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx'))))
    act(() => {
      useReviewStore.getState().start(same)
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
