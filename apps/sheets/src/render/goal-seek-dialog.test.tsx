import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalSeekDialog } from './goal-seek-dialog'

/**
 * The one thing in a spreadsheet that runs backwards.
 *
 * What is tested is the asking: three things a search needs, and no search
 * until it has all three.
 */

const asking = (props: Partial<React.ComponentProps<typeof GoalSeekDialog>> = {}) =>
  render(<GoalSeekDialog target="B5" onSeek={vi.fn()} onCancel={vi.fn()} {...props} />)

describe('asking for a goal', () => {
  it('starts on the cell the cursor was on', () => {
    asking()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Set cell' }).value).toBe('B5')
  })

  it('will not search until it knows all three', async () => {
    const user = userEvent.setup()
    const sought = vi.fn()
    asking({ onSeek: sought })

    const find = screen.getByRole('button', { name: 'Find' })
    expect(find).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'To value' }), '100')
    expect(find).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'By changing cell' }), 'A1')
    expect(find).toBeEnabled()

    await user.click(find)
    expect(sought).toHaveBeenCalledWith({ target: 'B5', wanted: '100', changing: 'A1' })
  })

  it('goes away when it is cancelled', async () => {
    const user = userEvent.setup()
    const cancelled = vi.fn()
    asking({ onCancel: cancelled })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancelled).toHaveBeenCalled()
  })
})
