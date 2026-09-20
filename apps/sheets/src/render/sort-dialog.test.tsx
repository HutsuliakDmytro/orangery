import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SortDialog } from './sort-dialog'

/**
 * Sorting by more than one column.
 *
 * What the dialog has to get right is the order of the levels — by region and
 * then by date is not the same table as by date and then by region — and the
 * one thing nobody can see from the outside: whether the top row is names.
 */

const columns = ['Region', 'Month', 'Amount']

const dialog = (props: Partial<React.ComponentProps<typeof SortDialog>> = {}) => {
  const sorted = vi.fn()
  render(
    <SortDialog columns={columns} header onSort={sorted} onCancel={() => undefined} {...props} />,
  )

  return sorted
}

describe('the sort dialog', () => {
  it('sorts by one column until it is asked for another', async () => {
    const sorted = dialog()
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(sorted).toHaveBeenCalledWith([{ column: 0, ascending: true }], true)
  })

  it('offers the columns by the names they are known by', () => {
    dialog()
    expect(screen.getByRole('option', { name: 'Region' })).toBeDefined()
  })

  it('keeps the levels in the order they are shown', async () => {
    const sorted = dialog()

    await userEvent.click(screen.getByRole('button', { name: 'Add another column' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), '0')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Then by 1' }), '2')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Order 1' }), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(sorted).toHaveBeenCalledWith(
      [
        { column: 0, ascending: true },
        { column: 2, ascending: false },
      ],
      true,
    )
  })

  it('sends a list along with the level that chose it', async () => {
    const sorted = dialog()

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Order' }),
      screen.getByRole('option', { name: 'January, February, March…' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))

    const keys = sorted.mock.calls[0]?.[0] as { order?: readonly string[] }[]
    expect(keys[0]?.order?.[0]).toBe('January')
  })

  it('takes back a level somebody added by mistake', async () => {
    const sorted = dialog()

    await userEvent.click(screen.getByRole('button', { name: 'Add another column' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove level 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(sorted.mock.calls[0]?.[0]).toHaveLength(1)
  })

  it('offers no more levels than there are columns', async () => {
    const sorted = dialog({ columns: ['Only one'] })

    expect(screen.queryByRole('button', { name: 'Add another column' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(sorted.mock.calls[0]?.[0]).toHaveLength(1)
  })

  it('lets the guess about the header row be corrected', async () => {
    const sorted = dialog()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Data has a header row' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(sorted.mock.calls[0]?.[1]).toBe(false)
  })
})
