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
  useViewStore.setState({ collapsedSections: [], renamingSection: null, contentFit: 'fit' })
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

describe('the slide size', () => {
  it('shows the size the deck is', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)

    expect(screen.getByLabelText<HTMLSelectElement>('Slide size')).toHaveValue('12192000x6858000')
  })

  it('changes the deck to the size that was picked', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Slide size'), { target: { value: '9144000x6858000' } })

    expect(useDeckStore.getState().open?.deck.slideSize).toEqual({
      width: 9144000,
      height: 6858000,
    })
  })

  it('scales the content when told to ensure it fits', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)

    const layout = [...(useDeckStore.getState().open?.deck.layouts.values() ?? [])][0]
    const before = layout?.shapes.find((shape) => shape.transform !== null)?.transform ?? null
    if (layout === undefined || before === null) throw new Error('fixture changed')

    fireEvent.change(screen.getByLabelText('Slide size'), { target: { value: '9144000x6858000' } })

    const after = useDeckStore
      .getState()
      .open?.deck.layouts.get(layout.path)
      ?.shapes.find((shape) => shape.transform !== null)?.transform

    expect(after?.width).toBe(Math.round(before.width * 0.75))
  })

  it('leaves the content alone when told to maximize', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)

    fireEvent.change(screen.getByLabelText('What happens to the content'), {
      target: { value: 'maximize' },
    })

    const layout = [...(useDeckStore.getState().open?.deck.layouts.values() ?? [])][0]
    const before = layout?.shapes.find((shape) => shape.transform !== null)?.transform ?? null
    if (layout === undefined || before === null) throw new Error('fixture changed')

    fireEvent.change(screen.getByLabelText('Slide size'), { target: { value: '9144000x6858000' } })

    const after = useDeckStore
      .getState()
      .open?.deck.layouts.get(layout.path)
      ?.shapes.find((shape) => shape.transform !== null)?.transform

    expect(after).toEqual(before)
  })

  it('takes a size typed in centimetres', async () => {
    await openDeck('empty')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Slide width in centimetres'), {
      target: { value: '20' },
    })

    expect(useDeckStore.getState().open?.deck.slideSize.width).toBe(20 * 360000)
  })

  it('is one undo step', async () => {
    await openDeck('sixteen-by-nine')
    render(<App />)

    fireEvent.change(screen.getByLabelText('Slide size'), { target: { value: '9144000x6858000' } })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(useDeckStore.getState().open?.deck.slideSize).toEqual({
      width: 12192000,
      height: 6858000,
    })
  })
})
