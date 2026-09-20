import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FormatDialog } from './format-dialog'

/**
 * The number-format dialog.
 *
 * A format code is a small language nobody remembers, so what the dialog has
 * to get right is the example: the value the cursor is on, shown as the code
 * would show it, changing as the code is typed.
 */

const dialog = (value: number | null = 1234.5, code = 'General') => {
  const onApply = vi.fn()
  render(
    <FormatDialog
      code={code}
      value={value}
      date1904={false}
      onApply={onApply}
      onCancel={() => undefined}
    />,
  )

  return onApply
}

const codeBox = () => screen.getByRole('textbox', { name: 'Format code' })
const example = () => screen.getByLabelText('Example').textContent

describe('the number format dialog', () => {
  it('opens on the code the cell already has', () => {
    dialog(1234.5, '0.00%')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Format code' }).value).toBe(
      '0.00%',
    )
  })

  it('shows the cell’s own value the way the code would show it', async () => {
    dialog(1234.5)

    await userEvent.clear(codeBox())
    await userEvent.type(codeBox(), '#,##0.00')

    expect(example()).toBe('1,234.50')
  })

  it('changes the example as the code is typed', async () => {
    dialog(0.15)

    await userEvent.clear(codeBox())
    await userEvent.type(codeBox(), '0.00%')

    expect(example()).toBe('15.00%')
  })

  it('says in words when a code shows nothing at all', async () => {
    // Which is the honest answer both for a code that hides the value and
    // for one that means nothing: either way the cell will look empty, and
    // a blank line would read as "this is fine".
    dialog(1)

    await userEvent.clear(codeBox())
    await userEvent.type(codeBox(), ';;;')

    expect(example()).toBe('Shows nothing')
  })

  it('fills the box from the list of the ones with names', async () => {
    dialog(1234.5)

    await userEvent.selectOptions(screen.getByRole('listbox', { name: 'Category' }), 'Percent')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Format code' }).value).toBe(
      '0.00%',
    )
  })

  it('hands back the code that was in the box', async () => {
    const onApply = dialog(1234.5)

    await userEvent.clear(codeBox())
    await userEvent.type(codeBox(), '0.0')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('0.0')
  })

  it('applies on Enter, which is what somebody typing a code expects', async () => {
    const onApply = dialog(1234.5)

    await userEvent.clear(codeBox())
    await userEvent.type(codeBox(), '0{Enter}')

    expect(onApply).toHaveBeenCalledWith('0')
  })

  it('applies nothing for an empty box', async () => {
    const onApply = dialog(1234.5)

    await userEvent.clear(codeBox())
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows a number of its own where the cell holds none', async () => {
    // A blank cell would otherwise make every example blank, which says
    // nothing about the code.
    dialog(null)

    await userEvent.clear(codeBox())
    await userEvent.type(codeBox(), '#,##0')

    expect(example()).toBe('1,235')
  })
})
