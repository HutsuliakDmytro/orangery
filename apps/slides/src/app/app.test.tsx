import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useViewStore } from '../store/view-store'

/**
 * The shell, and the wiring that makes it more than markup: commands come from
 * the registry, the panels answer to them, and the theme is one attribute.
 */

beforeEach(() => {
  useViewStore.setState({
    theme: 'dark',
    panels: { filmstrip: true, properties: true, notes: true },
  })
})

describe('the window', () => {
  it('lays out the four regions PowerPoint has', () => {
    render(<App />)

    expect(screen.getByRole('complementary', { name: 'Slides' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Speaker notes' })).toBeInTheDocument()
  })

  it('shows the welcome screen while there is no deck', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Orangery Slides' })).toBeInTheDocument()
  })

  it('offers a handle between each pair of panels', () => {
    render(<App />)
    expect(screen.getAllByRole('separator')).toHaveLength(3)
  })
})

describe('the panels answering to the registry', () => {
  it('hides a panel when its command runs, and the command reports it', () => {
    render(<App />)

    act(() => {
      runCommand('view.notes', {})
    })

    expect(screen.queryByRole('region', { name: 'Speaker notes' })).not.toBeInTheDocument()
    expect(useViewStore.getState().panels.notes).toBe(false)
  })

  it('marks a showing panel as active, which is what puts a tick in the menu', () => {
    const command = getCommand('view.filmstrip')

    expect(command?.isActive?.({})).toBe(true)
    act(() => {
      runCommand('view.filmstrip', {})
    })
    expect(command?.isActive?.({})).toBe(false)
  })
})

describe('the theme', () => {
  it('is a single attribute on the document', () => {
    render(<App />)
    expect(document.documentElement.dataset['theme']).toBe('dark')

    act(() => {
      runCommand('view.theme-light', {})
    })
    expect(document.documentElement.dataset['theme']).toBe('light')
  })
})

describe('what is not built yet', () => {
  it('registers the file commands disabled rather than leaving them out', () => {
    // The menu is the shape of the app: a File menu with nothing in it says the
    // app cannot open a deck, a greyed-out Open says it cannot do so yet.
    for (const id of ['file.new', 'file.open', 'file.save']) {
      const command = getCommand(id)
      expect(command, id).toBeDefined()
      expect(command?.isEnabled?.({}), id).toBe(false)
    }
  })

  it('greys out the welcome buttons through those same commands', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'New Presentation' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open…' })).toBeDisabled()
  })
})
