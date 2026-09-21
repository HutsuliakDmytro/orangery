import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FindPanel } from './find-panel'

/**
 * The find strip.
 *
 * What it has to get right is the count — whether the thing somebody typed is
 * in there at all — and that the options it is showing are the options the
 * search is given.
 */

const panel = (found = { at: 1, of: 3 }) => {
  const onFind = vi.fn().mockReturnValue(found)
  const onReplace = vi.fn()
  const onReplaceAll = vi.fn().mockReturnValue(4)

  render(
    <FindPanel
      onFind={onFind}
      onReplace={onReplace}
      onReplaceAll={onReplaceAll}
      onClose={() => undefined}
    />,
  )

  return { onFind, onReplace, onReplaceAll }
}

const typeTerm = async (text: string) => {
  await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), text)
}

describe('the find strip', () => {
  it('searches on Enter and says where it landed', async () => {
    panel()
    await typeTerm('north{Enter}')

    expect(screen.getByText('1 of 3')).toBeDefined()
  })

  it('says so plainly when there is nothing to find', async () => {
    panel({ at: 0, of: 0 })
    await typeTerm('nothing{Enter}')

    expect(screen.getByText('No matches')).toBeDefined()
  })

  it('goes backwards on Shift and Enter', async () => {
    const { onFind } = panel()
    await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), 'x{Shift>}{Enter}{/Shift}')

    expect(onFind).toHaveBeenCalledWith('x', expect.anything(), true)
  })

  it('hands the search the options it is showing', async () => {
    const { onFind } = panel()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Match case' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'In formulas' }))
    await typeTerm('x{Enter}')

    expect(onFind).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ matchCase: true, within: 'formulas' }),
      false,
    )
  })

  it('keeps replace out of the way until it is wanted', async () => {
    panel()
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Replace…' }))
    expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeDefined()
  })

  it('replaces one, with what was typed into both boxes', async () => {
    const { onReplace } = panel()

    await typeTerm('north')
    await userEvent.click(screen.getByRole('button', { name: 'Replace…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Replace with' }), 'west')
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }))

    expect(onReplace).toHaveBeenCalledWith('north', 'west', expect.anything())
  })

  it('reports how many a Replace All changed', async () => {
    panel()

    await typeTerm('north')
    await userEvent.click(screen.getByRole('button', { name: 'Replace…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Replace all' }))

    expect(screen.getByText('4 replaced')).toBeDefined()
  })

  it('searches for nothing rather than everything when the box is empty', async () => {
    const { onFind, onReplaceAll } = panel()

    await userEvent.click(screen.getByRole('button', { name: 'Find next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Replace…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Replace all' }))

    expect(onFind).not.toHaveBeenCalled()
    expect(onReplaceAll).not.toHaveBeenCalled()
  })
})
