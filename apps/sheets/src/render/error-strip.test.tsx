import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorStrip } from './error-strip'

/**
 * The sentence that says why a cell is an error.
 *
 * The useful half is the second one: an error is contagious, so a screen of
 * twenty wrong cells usually has one wrong cell in it, and this is what says
 * which.
 */

const strip = (props: Partial<React.ComponentProps<typeof ErrorStrip>> = {}) =>
  render(
    <ErrorStrip
      error="#DIV/0!"
      explanation="Something was divided by nought."
      blame={null}
      sheet="Budget"
      onGo={vi.fn()}
      {...props}
    />,
  )

describe('the strip', () => {
  it('says the error and what it means', () => {
    strip()

    expect(screen.getByText('#DIV/0!')).toBeInTheDocument()
    expect(screen.getByText('Something was divided by nought.')).toBeInTheDocument()
  })

  it("offers nowhere to go when the error is the cell's own", () => {
    strip()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names the cell an error came from', () => {
    strip({ blame: { sheet: 'Budget', row: 6, column: 1 } })
    expect(screen.getByRole('button', { name: 'It started at B7' })).toBeInTheDocument()
  })

  it('names the sheet too when it is not the one on screen', () => {
    // Going there is a jump between sheets, and somebody should know that
    // before they take it.
    strip({ blame: { sheet: 'Notes', row: 0, column: 0 } })
    expect(screen.getByRole('button', { name: 'It started at Notes!A1' })).toBeInTheDocument()
  })

  it('goes there when asked', async () => {
    const user = userEvent.setup()
    const went = vi.fn()
    strip({ blame: { sheet: 'Budget', row: 6, column: 1 }, onGo: went })

    await user.click(screen.getByRole('button'))
    expect(went).toHaveBeenCalledWith({ sheet: 'Budget', row: 6, column: 1 })
  })
})
