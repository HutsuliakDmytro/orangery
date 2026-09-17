import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * A deck in the window.
 *
 * Loaded through the store rather than through the file dialog: picking a file
 * is the shell's job and is not available in a browser, and what is worth
 * testing is everything after the bytes arrive.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const loadFixture = async (name: string) => {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

beforeEach(() => {
  useDeckStore.setState({ open: null, current: -1, error: null })
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
})

describe('before anything is open', () => {
  it('shows the welcome screen and an empty filmstrip', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Orangery Slides' })).toBeInTheDocument()
    expect(screen.getByText('No presentation open')).toBeInTheDocument()
  })
})

describe('with a deck open', () => {
  it('draws the current slide on the canvas', async () => {
    await loadFixture('placeholders')
    render(<App />)

    expect(screen.getAllByRole('img', { name: 'Slide: Placeholder inheritance' }).length).toBe(2)
  })

  it('lists every slide in the filmstrip', async () => {
    await loadFixture('many-slides')
    render(<App />)

    expect(screen.getAllByRole('button', { name: /^Slide \d+$/u })).toHaveLength(8)
  })

  it('says where in the deck we are', async () => {
    await loadFixture('many-slides')
    render(<App />)

    expect(screen.getByText('Slide 1 of 8')).toBeInTheDocument()
  })

  it('names the window after the file', async () => {
    await loadFixture('empty')
    render(<App />)

    expect(screen.getByText('empty.pptx')).toBeInTheDocument()
  })

  it('moves to the slide clicked in the filmstrip', async () => {
    const user = userEvent.setup()
    await loadFixture('many-slides')
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Slide 4' }))

    expect(useDeckStore.getState().current).toBe(3)
    expect(screen.getByText('Slide 4 of 8')).toBeInTheDocument()
  })

  it('walks the deck with the registry commands', async () => {
    await loadFixture('many-slides')
    render(<App />)

    act(() => {
      runCommand('view.next-slide', {})
      runCommand('view.next-slide', {})
    })
    expect(screen.getByText('Slide 3 of 8')).toBeInTheDocument()

    act(() => {
      runCommand('view.previous-slide', {})
    })
    expect(screen.getByText('Slide 2 of 8')).toBeInTheDocument()
  })

  it('stops at the ends rather than running off them', async () => {
    await loadFixture('many-slides')
    render(<App />)

    act(() => {
      useDeckStore.getState().select(-5)
    })
    expect(useDeckStore.getState().current).toBe(0)

    act(() => {
      useDeckStore.getState().select(99)
    })
    expect(useDeckStore.getState().current).toBe(7)
  })

  it('shows the speaker notes of the slide', async () => {
    await loadFixture('notes')
    render(<App />)

    expect(screen.getByText(/The quick brown fox/u)).toBeInTheDocument()
  })

  it('closes and goes back to the welcome screen', async () => {
    await loadFixture('empty')
    render(<App />)

    expect(getCommand('file.close')?.isEnabled?.({})).toBe(true)
    act(() => {
      runCommand('file.close', {})
    })

    expect(screen.getByRole('heading', { name: 'Orangery Slides' })).toBeInTheDocument()
  })
})

describe('a file that will not open', () => {
  it('says so and keeps the app standing', async () => {
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array([1, 2, 3]), '/decks/broken.pptx')
    })
    render(<App />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(useDeckStore.getState().open).toBeNull()
  })

  it('rejects a document, which is a zip but not a deck', async () => {
    const docx = join(process.cwd(), '../docs/tests/fixtures/docx/synthetic/headings.docx')
    await act(async () => {
      await useDeckStore.getState().load(new Uint8Array(await readFile(docx)), '/decks/a.docx')
    })

    expect(useDeckStore.getState().error).toContain('ppt/presentation.xml')
  })
})
