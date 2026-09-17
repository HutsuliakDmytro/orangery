import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../app/app'
import { isMac } from '@orangery/platform'

const openPalette = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.keyboard(
    isMac ? '{Meta>}{Shift>}p{/Shift}{/Meta}' : '{Control>}{Shift>}p{/Shift}{/Control}',
  )
}

describe('command palette', () => {
  beforeEach(() => {
    // same registry wiring the toolbar and native menu use.
  })

  it('is closed until its shortcut is pressed', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await openPalette(user)
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    })
  })

  it('filters commands as the user types', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openPalette(user)

    const input = await screen.findByLabelText('Search commands')
    await user.type(input, 'select')

    await waitFor(() => {
      expect(screen.getByText('Select All')).toBeInTheDocument()
    })
    expect(screen.queryByText('Redo')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openPalette(user)
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('hides commands that are currently disabled', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openPalette(user)
    await screen.findByRole('dialog')

    // Nothing has been typed yet, so the history is empty and Undo is disabled.
    expect(screen.queryByText('Undo')).not.toBeInTheDocument()
    expect(screen.getByText('Select All')).toBeInTheDocument()
  })
})
