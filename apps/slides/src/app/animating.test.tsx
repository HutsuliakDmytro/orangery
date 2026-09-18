import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readAnimations } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Giving a shape something to do, and taking it away.
 *
 * The panel lists the whole slide rather than the selected shape: an animation
 * is a thing that happens after something else, and a list of one shape's
 * effects would hide the only fact that matters about them.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })
})

const shapes = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

const steps = () => {
  const slide = useDeckStore.getState().open?.deck.slides[0]
  return slide === undefined ? [] : readAnimations(slide)
}

const pick = (index: number) => {
  act(() => {
    useDeckStore.getState().selectShapes([shapes()[index]?.id ?? -1])
  })
}

describe('adding an effect', () => {
  it('gives the picked shape one to play', async () => {
    const user = userEvent.setup()
    render(<App />)
    pick(0)

    await user.click(screen.getByRole('button', { name: 'Add entrance fade' }))

    expect(steps()).toHaveLength(1)
    expect(steps()[0]?.effects[0]).toMatchObject({ kind: 'entrance', shapeId: shapes()[0]?.id })
  })

  it('lists it in the order the slide plays it', async () => {
    const user = userEvent.setup()
    render(<App />)
    pick(0)
    await user.click(screen.getByRole('button', { name: 'Add entrance fade' }))
    pick(1)
    await user.click(screen.getByRole('button', { name: 'Add entrance wipe' }))

    expect(screen.getByLabelText('Effect 1').textContent).toContain('Rectangle')
    expect(screen.getByLabelText('Effect 2').textContent).toContain('Oval')
  })

  it('says so when the slide plays nothing', () => {
    render(<App />)
    pick(0)

    expect(screen.getByText('This slide plays nothing.')).toBeInTheDocument()
  })
})

describe('changing one', () => {
  /** Puts a fade on the first two shapes and renders the panel. */
  async function withTwo() {
    const user = userEvent.setup()
    render(<App />)
    pick(0)
    await user.click(screen.getByRole('button', { name: 'Add entrance fade' }))
    pick(1)
    await user.click(screen.getByRole('button', { name: 'Add entrance fade' }))
    return user
  }

  it('moves one earlier', async () => {
    const user = await withTwo()
    const second = steps()[1]?.effects[0]?.shapeId

    await user.click(screen.getByRole('button', { name: 'Move effect 2 earlier' }))

    expect(steps()[0]?.effects[0]?.shapeId).toBe(second)
  })

  it('takes one away', async () => {
    const user = await withTwo()
    await user.click(screen.getByRole('button', { name: 'Remove effect 1' }))

    expect(steps()).toHaveLength(1)
  })

  it('changes what starts it', async () => {
    const user = await withTwo()
    await user.selectOptions(screen.getByLabelText('Effect 2 starts'), 'with')

    // Two effects, one press: "with previous" is what makes a step of them.
    expect(steps()).toHaveLength(1)
    expect(steps()[0]?.effects).toHaveLength(2)
  })

  it('changes how long it takes', async () => {
    const user = await withTwo()
    await user.selectOptions(screen.getByLabelText('Effect 1 speed'), '2000')

    expect(steps()[0]?.effects[0]?.duration).toBe(2000)
  })

  it('is one step to undo', async () => {
    const user = await withTwo()
    const before = steps().length

    await user.click(screen.getByRole('button', { name: 'Remove effect 1' }))
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(steps()).toHaveLength(before)
  })
})
