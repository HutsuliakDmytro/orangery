import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { flatten } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Copy, cut and paste, through the clipboard a second window would read.
 *
 * The clipboard itself is stood in for, because jsdom has none and because
 * what is worth testing is that the right text goes onto it and the right
 * shapes come off — not that the browser can hold a string.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const held = { text: '' }

beforeEach(async () => {
  held.text = ''
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        held.text = text
        return Promise.resolve()
      },
      readText: () => Promise.resolve(held.text),
    },
  })

  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })
})

const shapes = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []
const selectFirst = () => {
  act(() => {
    useDeckStore.getState().selectShapes([shapes()[0]?.id ?? 0])
  })
}

const run = async (id: string) => {
  await act(async () => {
    runCommand(id, {})
    await Promise.resolve()
  })
}

describe('copying', () => {
  it('puts the shape on the clipboard as our own text', async () => {
    render(<App />)
    selectFirst()

    await run('edit.copy')

    await waitFor(() => {
      expect(held.text).toContain('orangery/slides-shapes')
    })
    expect(held.text).toContain('<p:sp>')
  })

  it('is offered only when something is selected', () => {
    render(<App />)
    expect(getCommand('edit.copy')?.isEnabled?.({})).toBe(false)
    selectFirst()
    expect(getCommand('edit.copy')?.isEnabled?.({})).toBe(true)
  })
})

describe('pasting', () => {
  it('puts a copy beside the original when it comes back to the same slide', async () => {
    render(<App />)
    selectFirst()
    const before = shapes().length
    const origin = shapes()[0]?.transform?.x ?? 0

    await run('edit.copy')
    await run('edit.paste')

    await waitFor(() => {
      expect(shapes()).toHaveLength(before + 1)
    })
    // Beside, not on top: two shapes in the same place look like one, and the
    // person would think the paste did nothing.
    const pasted = shapes()[before]
    expect(pasted?.transform?.x).toBe(origin + 228600)
  })

  it('selects what it pasted, which is what you are about to move', async () => {
    render(<App />)
    selectFirst()

    await run('edit.copy')
    await run('edit.paste')

    await waitFor(() => {
      expect(useDeckStore.getState().selection).toHaveLength(1)
    })
    expect(useDeckStore.getState().selection[0]).not.toBe(shapes()[0]?.id)
  })

  it('keeps the position when the shapes land on a different slide', async () => {
    render(<App />)
    selectFirst()
    const origin = shapes()[0]?.transform?.x ?? 0
    await run('edit.copy')

    // A second slide, which the clipboard knows nothing about.
    act(() => {
      runCommand('slide.new', {})
    })
    await run('edit.paste')

    await waitFor(() => {
      const current = useDeckStore.getState()
      expect(current.open?.deck.slides[current.current]?.shapes.length).toBeGreaterThan(0)
    })

    const current = useDeckStore.getState()
    const landed = flatten(current.open?.deck.slides[current.current]?.shapes ?? [])
    expect(landed.some((shape) => shape.transform?.x === origin)).toBe(true)
  })

  it('does nothing with text that is not ours', async () => {
    render(<App />)
    held.text = 'just some words'
    const before = shapes().length

    await run('edit.paste')

    expect(shapes()).toHaveLength(before)
  })
})

describe('cutting', () => {
  it('takes the shape away and leaves it on the clipboard', async () => {
    render(<App />)
    selectFirst()
    const before = shapes().length

    await run('edit.cut')

    await waitFor(() => {
      expect(shapes()).toHaveLength(before - 1)
    })
    expect(held.text).toContain('orangery/slides-shapes')
    expect(useDeckStore.getState().selection).toEqual([])
  })

  it('can be pasted back', async () => {
    render(<App />)
    selectFirst()
    const before = shapes().length

    await run('edit.cut')
    await waitFor(() => {
      expect(shapes()).toHaveLength(before - 1)
    })
    await run('edit.paste')

    await waitFor(() => {
      expect(shapes()).toHaveLength(before)
    })
  })
})
