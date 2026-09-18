import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/** Adding, removing and reordering the slides of a deck. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const titles = () =>
  (useDeckStore.getState().open?.deck.slides ?? []).map((slide) =>
    slide.shapes[0]?.text == null ? '' : textOfBody(slide.shapes[0].text),
  )

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    selection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
  useViewStore.setState({ finding: false })
})

describe('a new slide', () => {
  it('goes in after the one being shown', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(2)
      runCommand('slide.new', {})
    })

    expect(titles()[2]).toBe('Slide 3')
    expect(titles()[3]).toBe('')
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(9)
  })

  it('becomes the slide being shown', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.new', {})
    })

    expect(useDeckStore.getState().current).toBe(1)
  })

  it('appears in the filmstrip', async () => {
    await openDeck('empty')
    render(<App />)

    act(() => {
      runCommand('slide.new', {})
    })

    expect(screen.getAllByRole('button', { name: /^Slide \d+$/u })).toHaveLength(2)
  })

  it('is taken back in one step, part and all', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('slide.new', {})
    })
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(2)

    act(() => {
      runCommand('edit.undo', {})
    })
    expect(useDeckStore.getState().open?.deck.slides).toHaveLength(1)
  })

  it('can be added twice without landing on the same part', async () => {
    await openDeck('empty')
    act(() => {
      runCommand('slide.new', {})
      runCommand('slide.new', {})
    })

    const paths = (useDeckStore.getState().open?.deck.slides ?? []).map((slide) => slide.path)
    expect(new Set(paths).size).toBe(3)
  })
})

describe('removing a slide', () => {
  it('takes it out and steps back', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(3)
      runCommand('slide.delete', {})
    })

    expect(titles()).not.toContain('Slide 4')
    expect(useDeckStore.getState().current).toBe(2)
  })

  it('is greyed out on a deck of one, which PowerPoint will not open empty', async () => {
    await openDeck('empty')
    expect(getCommand('slide.delete')?.isEnabled?.({})).toBe(false)
  })
})

describe('reordering', () => {
  it('moves a slide up and follows it', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(3)
      runCommand('slide.move-up', {})
    })

    expect(titles()[2]).toBe('Slide 4')
    expect(titles()[3]).toBe('Slide 3')
    expect(useDeckStore.getState().current).toBe(2)
  })

  it('moves a slide down', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.move-down', {})
    })

    expect(titles()[0]).toBe('Slide 2')
    expect(titles()[1]).toBe('Slide 1')
  })

  it('stops at the ends', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
    })
    expect(getCommand('slide.move-up')?.isEnabled?.({})).toBe(false)

    act(() => {
      useDeckStore.getState().select(7)
    })
    expect(getCommand('slide.move-down')?.isEnabled?.({})).toBe(false)
  })

  it('leaves the parts where they were, since only the list decides order', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(0)
      runCommand('slide.move-down', {})
    })

    expect(useDeckStore.getState().open?.deck.slides[1]?.path).toBe('ppt/slides/slide1.xml')
  })
})
