import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './app'

describe('App', () => {
  it('renders the document title bar', () => {
    render(<App />)
    expect(screen.getByText('Untitled document')).toBeInTheDocument()
  })

  it('offers the welcome screen when there is nothing to work on', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Orangery Docs' })).toBeInTheDocument()
  })

  it('mounts an editable editor surface once the welcome screen is dismissed', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(await screen.findByRole('button', { name: /Blank document/u }))

    // jsdom does not map `contenteditable` to the textbox role, so the surface
    // is located by the class ProseMirror renders it with.
    await waitFor(() => {
      expect(container.querySelector('.editor-surface')).toHaveAttribute('contenteditable', 'true')
    })
  })
})
