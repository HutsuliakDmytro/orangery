import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AutoFilter } from '@orangery/ooxml-spreadsheet'
import { FilterMenu } from './filter-menu'

/**
 * The box behind a filter arrow.
 *
 * Two ways of saying the same thing — a list of values, or a condition — and
 * the box has to show which of them the column is already using, because a
 * filter that arrived in a file is a filter somebody is about to change.
 */

const range = { sheet: null, from: { row: 0, column: 0 }, to: { row: 3, column: 0 } }
const choices = { values: ['January', 'February', 'March'], blanks: false }

const menu = (filter: AutoFilter) => {
  const applied = vi.fn()
  render(
    <FilterMenu
      filter={filter}
      column={0}
      choices={choices}
      at={{ left: 0, top: 0 }}
      onApply={applied}
      onClose={() => undefined}
    />,
  )

  return applied
}

const plain: AutoFilter = { range, columns: [] }

describe('the filter box', () => {
  it('opens with everything ticked, which is what no filter looks like', async () => {
    const applied = menu(plain)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    // Nothing filtered clears the criteria rather than listing every value.
    expect(applied).toHaveBeenCalledWith(null)
  })

  it('keeps the values still ticked', async () => {
    const applied = menu(plain)

    await userEvent.click(screen.getByRole('checkbox', { name: 'March' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(applied).toHaveBeenCalledWith({
      kind: 'values',
      values: ['January', 'February'],
      blanks: false,
    })
  })

  it('asks for a value only once a condition is chosen', async () => {
    menu(plain)
    expect(screen.queryByRole('textbox', { name: 'Condition value' })).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'contains')
    expect(screen.getByRole('textbox', { name: 'Condition value' })).toBeDefined()
  })

  it('sends the condition in the file’s own spelling', async () => {
    const applied = menu(plain)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'contains')
    await userEvent.type(screen.getByRole('textbox', { name: 'Condition value' }), 'ary')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(applied).toHaveBeenCalledWith({
      kind: 'conditions',
      all: false,
      conditions: [{ operator: 'equal', value: '*ary*' }],
    })
  })

  it('shows the condition a file arrived with, in words', () => {
    menu({
      range,
      columns: [
        {
          column: 0,
          criteria: {
            kind: 'conditions',
            all: false,
            conditions: [{ operator: 'greaterThan', value: '5' }],
          },
        },
      ],
    })

    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Condition' }).value).toBe(
      'greaterThan',
    )
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Condition value' }).value).toBe(
      '5',
    )
  })

  it('shows the ticks a file arrived with', () => {
    menu({
      range,
      columns: [{ column: 0, criteria: { kind: 'values', values: ['January'], blanks: false } }],
    })

    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'January' }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'March' }).checked).toBe(false)
  })
})
