import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormulaBar } from './formula-bar'

/**
 * The strip that shows what is in the cell rather than what it looks like.
 *
 * What is tested is the three ways out of it — Enter, Escape, and looking
 * elsewhere — and the one thing it has to do while nobody is typing: follow
 * the cursor without throwing away half-typed text.
 */

const bar = (props: Partial<React.ComponentProps<typeof FormulaBar>> = {}) =>
  render(<FormulaBar text="=A1+1" onCommit={vi.fn()} {...props} />)

const box = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Formula bar' })

describe('the formula bar', () => {
  it('shows what the cell holds rather than what it shows', () => {
    bar({ text: '=6*7' })
    expect(box().value).toBe('=6*7')
  })

  it('hands the text over on Enter', async () => {
    const user = userEvent.setup()
    const committed = vi.fn()
    bar({ text: '1', onCommit: committed })

    await user.click(box())
    await user.keyboard('{Backspace}=1+1{Enter}')

    expect(committed).toHaveBeenCalledWith('=1+1')
  })

  it('puts the old text back on Escape', async () => {
    const user = userEvent.setup()
    const committed = vi.fn()
    bar({ text: '=A1+1', onCommit: committed })

    await user.click(box())
    await user.keyboard('rubbish{Escape}')

    expect(box().value).toBe('=A1+1')
    expect(committed).not.toHaveBeenCalled()
  })

  it('puts it in when somebody looks elsewhere', async () => {
    // Which is what the cell editor does, and what a person who typed
    // something and clicked away meant.
    const user = userEvent.setup()
    const committed = vi.fn()
    bar({ text: '1', onCommit: committed })

    await user.click(box())
    await user.keyboard('2')
    await user.tab()

    expect(committed).toHaveBeenCalledWith('12')
  })

  it('says nothing when nothing was typed', async () => {
    const user = userEvent.setup()
    const committed = vi.fn()
    bar({ text: '=A1+1', onCommit: committed })

    await user.click(box())
    await user.tab()

    expect(committed).not.toHaveBeenCalled()
  })

  it('follows the cursor when it moves on its own', () => {
    const { rerender } = bar({ text: '=A1+1' })
    rerender(<FormulaBar text="42" onCommit={vi.fn()} />)

    expect(box().value).toBe('42')
  })
})
