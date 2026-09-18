import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { getPartText } from '@orangery/ooxml-core'
import { slideName, themePathsOf } from '@orangery/ooxml-presentation'
import { App } from './app'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useEditorStore } from '../store/editor-store'
import { useViewStore } from '../store/view-store'

/** Editing the layouts and masters a deck is built on, and its theme. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const enterMaster = () => {
  act(() => {
    runCommand('view.master', {})
  })
}

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    master: null,
    selection: [],
    slideSelection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
  useViewStore.setState({ leftPane: 'filmstrip', editingOutline: null, contentFit: 'fit' })
})

describe('the slide master view', () => {
  it('opens on the layout the slide being shown is built on', async () => {
    await openDeck('placeholders')
    render(<App />)

    const layout = useDeckStore.getState().open?.deck.slides[0]?.layout
    enterMaster()

    expect(useDeckStore.getState().master).toBe(layout)
  })

  it('shows the masters and their layouts instead of the slides', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    expect(screen.getByLabelText('Masters')).toBeInTheDocument()
    expect(screen.queryByLabelText('Slide 1')).toBeNull()
  })

  it('lists every layout the master offers', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    const deck = useDeckStore.getState().open?.deck
    const master = [...(deck?.masters.values() ?? [])][0]
    if (master === undefined || deck === undefined) throw new Error('fixture changed')

    for (const path of master.layouts) {
      const layout = deck.layouts.get(path)
      if (layout === undefined) continue
      expect(screen.getByLabelText(`Layout ${slideName(layout)}`)).toBeInTheDocument()
    }
  })

  it('puts the chosen part on the canvas', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    const master = [...(useDeckStore.getState().open?.deck.masters.values() ?? [])][0]
    if (master === undefined) throw new Error('fixture changed')

    await userEvent.click(screen.getByLabelText(`Master ${slideName(master)}`))

    expect(currentSlide(useDeckStore.getState())?.path).toBe(master.path)
  })

  it('goes back to the slide that was on screen', async () => {
    await openDeck('many-slides')
    render(<App />)
    act(() => {
      useDeckStore.getState().select(3)
    })

    enterMaster()
    enterMaster()

    expect(useDeckStore.getState().master).toBeNull()
    expect(useDeckStore.getState().current).toBe(3)
  })

  it('says so in the header rather than naming a slide that is not there', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    expect(screen.getByText('Slide Master')).toBeInTheDocument()
  })
})

describe('what a layout can and cannot be asked to do', () => {
  it('does not offer the commands about slides', async () => {
    await openDeck('many-slides')
    render(<App />)
    enterMaster()

    for (const id of ['slide.new', 'slide.delete', 'slide.duplicate', 'section.add']) {
      expect(getCommand(id)?.isEnabled?.({})).toBe(false)
    }
  })

  it('has no layout picker of its own', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    expect(screen.queryByLabelText('Layout')).toBeNull()
    expect(screen.getByLabelText('Background')).toBeInTheDocument()
  })
})

describe('editing a layout', () => {
  it('writes the change into the layout part, not a slide', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    const path = useDeckStore.getState().master ?? ''
    const before = getPartText(useDeckStore.getState().open?.package ?? { parts: new Map() }, path)

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'solid' } })

    const after = getPartText(useDeckStore.getState().open?.package ?? { parts: new Map() }, path)
    expect(after).not.toBe(before)
    expect(after ?? '').toContain('p:bg')
  })

  it('leaves the slides alone', async () => {
    await openDeck('placeholders')
    render(<App />)
    const pkg = () => useDeckStore.getState().open?.package ?? { parts: new Map() }
    const before = getPartText(pkg(), 'ppt/slides/slide1.xml')

    enterMaster()
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'solid' } })

    expect(getPartText(pkg(), 'ppt/slides/slide1.xml')).toBe(before)
  })

  it('is one undo step', async () => {
    await openDeck('placeholders')
    render(<App />)
    enterMaster()

    const path = useDeckStore.getState().master ?? ''
    const pkg = () => useDeckStore.getState().open?.package ?? { parts: new Map() }
    const before = getPartText(pkg(), path)

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'solid' } })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(getPartText(pkg(), path)).toBe(before)
  })
})

describe('the theme gallery', () => {
  const themePart = () => {
    const open = useDeckStore.getState().open
    const path = open === null ? undefined : themePathsOf(open.deck)[0]
    return path === undefined
      ? ''
      : (getPartText(open?.package ?? { parts: new Map() }, path) ?? '')
  }

  it('repaints the deck through the theme, not the slides', async () => {
    await openDeck('shapes')
    render(<App />)
    const before = getPartText(
      useDeckStore.getState().open?.package ?? { parts: new Map() },
      'ppt/slides/slide1.xml',
    )

    await userEvent.click(screen.getByLabelText('Theme Orangery'))

    expect(themePart()).toContain('FF7A00')
    expect(
      getPartText(
        useDeckStore.getState().open?.package ?? { parts: new Map() },
        'ppt/slides/slide1.xml',
      ),
    ).toBe(before)
  })

  it('shows which theme the deck is on', async () => {
    await openDeck('shapes')
    render(<App />)

    await userEvent.click(screen.getByLabelText('Theme Slate'))

    expect(screen.getByLabelText('Theme Slate')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Theme Orangery')).toHaveAttribute('aria-pressed', 'false')
  })

  it('is one undo step', async () => {
    await openDeck('shapes')
    render(<App />)
    const before = themePart()

    await userEvent.click(screen.getByLabelText('Theme Orangery'))
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(themePart()).toBe(before)
  })
})

describe('the font picker', () => {
  const enterText = async () => {
    await openDeck('shapes')
    render(<App />)
    act(() => {
      useDeckStore
        .getState()
        .setEditing(useDeckStore.getState().open?.deck.slides[0]?.shapes[0]?.id ?? null)
    })
  }

  it('offers the two theme fonts before the families', async () => {
    await enterText()
    const picker = await screen.findByLabelText<HTMLSelectElement>('Font')

    expect([...picker.options].slice(0, 3).map((option) => option.text)).toEqual([
      'Inherited',
      'Heading',
      'Body',
    ])
  })

  it('writes the theme font as a reference, not as the family it is today', async () => {
    // "This heading is the heading font" follows the deck; "this heading is
    // Inter" is a decision that outlives the reason for it.
    await enterText()
    fireEvent.change(await screen.findByLabelText('Font'), { target: { value: '+mj-lt' } })

    expect(useEditorStore.getState().editor?.getAttributes('textStyle')['fontFamily']).toBe(
      '+mj-lt',
    )
  })

  it('sets a size in points', async () => {
    await enterText()
    fireEvent.change(await screen.findByLabelText('Font size'), { target: { value: '32' } })

    expect(useEditorStore.getState().editor?.getAttributes('textStyle')['fontSize']).toBe(32)
  })

  it('reaches the file as a typeface on the run', async () => {
    await enterText()
    fireEvent.change(await screen.findByLabelText('Font'), { target: { value: '+mj-lt' } })
    act(() => {
      useEditorStore.getState().editor?.commands.selectAll()
    })
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: '+mj-lt' } })

    // Leaving unmounts the editor, which is what commits.
    act(() => {
      runCommand('edit.leave-text', {})
    })

    const text = getPartText(
      useDeckStore.getState().open?.package ?? { parts: new Map() },
      'ppt/slides/slide1.xml',
    )
    expect(text ?? '').toContain('+mj-lt')
  })
})
