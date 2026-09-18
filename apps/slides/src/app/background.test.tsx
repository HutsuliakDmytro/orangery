import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { masterShapesShown, readBackground } from '@orangery/ooxml-presentation'
import { getPartText } from '@orangery/ooxml-core'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/** The background of a slide, and the master graphics behind it. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const own = () => {
  const slide = useDeckStore.getState().open?.deck.slides[0]
  return slide === undefined ? null : readBackground(slide, undefined)
}

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    selection: [],
    slideSelection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
  useViewStore.setState({ collapsedSections: [], renamingSection: null })
})

describe('the background picker', () => {
  it('starts on "from layout" for a slide that states none', async () => {
    await openDeck('empty')
    render(<App />)

    expect(screen.getByLabelText<HTMLSelectElement>('Background')).toHaveValue('inherit')
    expect(own()).toBeNull()
  })

  it('paints the slide a colour', async () => {
    await openDeck('empty')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'solid' } })
    fireEvent.change(await screen.findByLabelText('Background colour'), {
      target: { value: '#ff7a00' },
    })

    expect(own()?.fill).toEqual({
      kind: 'solid',
      color: { source: { kind: 'srgb', hex: '#FF7A00' }, transforms: [] },
    })
  })

  it('writes a gradient with both stops and the angle', async () => {
    await openDeck('empty')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'gradient' } })
    fireEvent.change(await screen.findByLabelText('Gradient angle'), { target: { value: '45' } })

    const fill = own()?.fill
    expect(fill?.kind).toBe('gradient')
    expect(fill?.kind === 'gradient' ? fill.angle : null).toBe(45 * 60000)
    expect(fill?.kind === 'gradient' ? fill.stops.length : 0).toBe(2)
  })

  it('goes back to inheriting, which is not a background of none', async () => {
    await openDeck('empty')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'none' } })
    expect(own()?.fill).toEqual({ kind: 'none' })

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'inherit' } })
    expect(own()).toBeNull()
  })

  it('is one undo step per change', async () => {
    await openDeck('empty')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'solid' } })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(own()).toBeNull()
  })
})

describe('hiding the background graphics', () => {
  it('records it on the slide', async () => {
    await openDeck('empty')
    render(<App />)

    await userEvent.click(screen.getByLabelText('Hide background graphics'))

    const slide = useDeckStore.getState().open?.deck.slides[0]
    expect(slide === undefined ? null : masterShapesShown(slide)).toBe(false)
  })

  it('leaves no attribute behind when turned back on', async () => {
    await openDeck('empty')
    render(<App />)

    const box = screen.getByLabelText('Hide background graphics')
    await userEvent.click(box)
    await userEvent.click(box)

    const slide = useDeckStore.getState().open?.deck.slides[0]
    expect(slide === undefined ? null : masterShapesShown(slide)).toBe(true)
    expect(
      getPartText(
        useDeckStore.getState().open?.package ?? { parts: new Map() },
        'ppt/slides/slide1.xml',
      ),
    ).not.toContain('showMasterSp')
  })
})
