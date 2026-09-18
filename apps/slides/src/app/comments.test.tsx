import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Reading and writing what people said about a slide.
 *
 * The pane is a view of the comment parts, so every assertion reads the
 * package: a remark shown in the pane and missing from the file is the failure
 * worth catching.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({
    commenting: false,
    panels: { filmstrip: true, properties: true, notes: true },
  })

  const bytes = await readFile(join(FIXTURES, 'many-slides.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/many.pptx')
  })
})

const open = () => {
  act(() => {
    runCommand('review.comments', {})
  })
}

const commentPart = () => {
  const { open: deck } = useDeckStore.getState()
  return getPartText(deck?.package ?? { parts: new Map() }, 'ppt/comments/comment1.xml') ?? ''
}

describe('the comments pane', () => {
  it('opens and closes on the command', async () => {
    const user = userEvent.setup()
    render(<App />)
    open()

    expect(screen.getByLabelText('Comments')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close comments' }))
    expect(screen.queryByLabelText('Comments')).not.toBeInTheDocument()
  })

  it('says so when nothing has been said', () => {
    render(<App />)
    open()

    expect(screen.getByText('Nothing has been said about this slide.')).toBeInTheDocument()
  })
})

describe('saying something', () => {
  it('writes it into the deck', async () => {
    const user = userEvent.setup()
    render(<App />)
    open()

    await user.type(screen.getByLabelText('New comment'), 'Move this up')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect(commentPart()).toContain('Move this up')
    expect(screen.getByText('Move this up')).toBeInTheDocument()
  })

  it('will not say nothing', () => {
    render(<App />)
    open()

    // A blank remark is a press of the button, not a thing anybody said.
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
  })

  it('belongs to the slide it was said about', async () => {
    const user = userEvent.setup()
    render(<App />)
    open()

    await user.type(screen.getByLabelText('New comment'), 'About slide one')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    act(() => {
      useDeckStore.getState().select(1)
    })

    expect(screen.queryByText('About slide one')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing has been said about this slide.')).toBeInTheDocument()
  })

  it('takes one back', async () => {
    const user = userEvent.setup()
    render(<App />)
    open()

    await user.type(screen.getByLabelText('New comment'), 'Never mind')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await user.click(screen.getByRole('button', { name: 'Delete comment by Me' }))

    expect(screen.queryByText('Never mind')).not.toBeInTheDocument()
    expect(commentPart()).not.toContain('Never mind')
  })

  it('is one step to undo', async () => {
    const user = userEvent.setup()
    render(<App />)
    open()

    await user.type(screen.getByLabelText('New comment'), 'Undo me')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    act(() => {
      useDeckStore.getState().undo()
    })
    expect(commentPart()).not.toContain('Undo me')
  })
})
