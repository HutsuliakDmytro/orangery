import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useWorkbookStore } from '../store/workbook-store'

/**
 * The window, with and without a workbook in it.
 *
 * What a reader can do today: open a file, see the sheet it opens on, move
 * between its sheets. Everything here goes through the same doors a person
 * uses — the command registry and the tabs — rather than through the store.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

const load = async () => {
  const bytes = new Uint8Array(await readFile(FIXTURE))
  await act(async () => {
    await useWorkbookStore.getState().load(bytes, '/books/budget.xlsx')
  })
}

beforeEach(() => {
  useWorkbookStore.getState().close()
})

describe('a window with nothing in it', () => {
  it('says so, and offers the one thing there is to do', () => {
    render(<App />)

    expect(screen.getByText('No workbook open')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open a workbook…' })).toBeInTheDocument()
  })

  it('has no tabs, because there are no sheets', () => {
    render(<App />)
    expect(screen.queryByRole('navigation', { name: 'Sheets' })).not.toBeInTheDocument()
  })

  it('cannot open a file without a shell to ask for one', () => {
    // In a browser there is no dialog and no disk, so the command is shown
    // disabled rather than failing when it is chosen.
    render(<App />)
    expect(getCommand('file.open')?.isEnabled?.({})).toBe(false)
  })

  it('cannot save what is not open', () => {
    render(<App />)
    expect(getCommand('file.save')?.isEnabled?.({})).toBe(false)
  })
})

describe('a window with a workbook', () => {
  it('shows the sheet the workbook was left on', async () => {
    render(<App />)
    await load()

    expect(await screen.findByRole('grid', { name: 'Budget' })).toBeInTheDocument()
  })

  it('offers a tab per sheet a person can see', async () => {
    render(<App />)
    await load()

    const tabs = screen.getByRole('navigation', { name: 'Sheets' })

    // The fixture has three sheets and one of them is hidden.
    expect(tabs.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Working' })).not.toBeInTheDocument()
  })

  it('changes sheet when a tab is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    expect(await screen.findByRole('grid', { name: 'Notes' })).toBeInTheDocument()
  })

  it('moves between sheets from the keyboard, through the registry', async () => {
    render(<App />)
    await load()

    act(() => {
      runCommand('sheet.next', {})
    })

    expect(await screen.findByRole('grid', { name: 'Notes' })).toBeInTheDocument()
  })

  it('stops at the last sheet rather than running off the end', async () => {
    render(<App />)
    await load()

    act(() => {
      runCommand('sheet.next', {})
      runCommand('sheet.next', {})
    })

    expect(await screen.findByRole('grid', { name: 'Notes' })).toBeInTheDocument()
  })

  it('closes, leaving the window as it was before', async () => {
    render(<App />)
    await load()

    act(() => {
      runCommand('file.close', {})
    })

    await waitFor(() => {
      expect(screen.getByText('No workbook open')).toBeInTheDocument()
    })
  })
})

describe('a file that will not open', () => {
  it('says what happened and keeps what was open', async () => {
    render(<App />)
    await load()

    act(() => {
      useWorkbookStore.getState().fail('Could not open notes.txt.')
    })

    // The workbook on screen stays: a file that would not open is a reason to
    // say so, not a reason to take away the one being worked on.
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open notes.txt.')
    expect(screen.getByRole('grid', { name: 'Budget' })).toBeInTheDocument()
  })

  it('goes away when it is dismissed', async () => {
    const user = userEvent.setup()
    render(<App />)

    act(() => {
      useWorkbookStore.getState().fail('Could not open notes.txt.')
    })
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the box that says where you are', () => {
  it('shows the cell the cursor is on', async () => {
    render(<App />)
    await load()

    expect(await screen.findByLabelText('Name box')).toHaveValue('A1')
  })

  it('takes you where you type', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'C7{Enter}')

    expect(useWorkbookStore.getState().selection.active).toEqual({ row: 6, column: 2 })
  })

  it('selects a range when given one', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'B2:D5{Enter}')

    await waitFor(() => {
      expect(screen.getByText('12 cells')).toBeInTheDocument()
    })
  })

  it('puts back the old address rather than keeping a wrong one', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'nowhere{Enter}')

    expect(box).toHaveValue('A1')
    expect(useWorkbookStore.getState().selection.active).toEqual({ row: 0, column: 0 })
  })

  it('starts again on the first cell when the sheet changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await load()

    const box = await screen.findByLabelText('Name box')
    await user.clear(box)
    await user.type(box, 'C7{Enter}')

    await user.click(screen.getByRole('button', { name: 'Notes' }))

    // A selection belongs to the sheet it was made on.
    expect(await screen.findByLabelText('Name box')).toHaveValue('A1')
  })
})
