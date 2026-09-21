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

describe('the functions it offers while a name is being typed', () => {
  const functions = [
    { name: 'SUM', least: 1, most: null, volatile: false },
    { name: 'SUMIF', least: 2, most: 3, volatile: false },
    { name: 'SUMIFS', least: 3, most: null, volatile: false },
  ]

  const offering = (text = '') =>
    render(<FormulaBar text={text} functions={functions} onCommit={vi.fn()} />)

  it('offers what a half-typed name could become', async () => {
    const user = userEvent.setup()
    offering()

    await user.click(box())
    await user.keyboard('=SUM')

    expect(screen.getByRole('list', { name: 'Functions' })).toBeTruthy()
    expect(screen.getAllByRole('button').map((one) => one.textContent)).toEqual([
      'SUM1 or more arguments',
      'SUMIF2 to 3 arguments',
      'SUMIFS3 or more arguments',
    ])
  })

  it('offers nothing in a cell that is not a formula', async () => {
    const user = userEvent.setup()
    offering()

    await user.click(box())
    await user.keyboard('Sum of things')

    expect(screen.queryByRole('list', { name: 'Functions' })).toBeNull()
  })

  it('puts the chosen one in rather than committing half a formula', async () => {
    // Which is what every spreadsheet does, and what the fingers expect.
    const user = userEvent.setup()
    const committed = vi.fn()
    render(<FormulaBar text="" functions={functions} onCommit={committed} />)

    await user.click(box())
    await user.keyboard('=SUM{ArrowDown}{Enter}')

    expect(box().value).toBe('=SUMIF(')
    expect(committed).not.toHaveBeenCalled()
  })

  it('commits once the list has gone', async () => {
    const user = userEvent.setup()
    const committed = vi.fn()
    render(<FormulaBar text="" functions={functions} onCommit={committed} />)

    await user.click(box())
    await user.keyboard('=SUM(A1){Enter}')

    expect(committed).toHaveBeenCalledWith('=SUM(A1)')
  })
})

describe('the references in a formula', () => {
  it('moves the dollars on with F4, on the one under the caret', async () => {
    const user = userEvent.setup()
    render(<FormulaBar text="=A1+B2" onCommit={vi.fn()} functions={[]} />)

    const box = screen.getByRole<HTMLInputElement>('textbox', { name: 'Formula bar' })
    await user.click(box)
    box.setSelectionRange(3, 3)

    await user.keyboard('{F4}')
    expect(box.value).toBe('=$A$1+B2')

    await user.keyboard('{F4}')
    expect(box.value).toBe('=A$1+B2')
  })

  it('leaves F4 alone when the caret is not in a reference', async () => {
    const user = userEvent.setup()
    render(<FormulaBar text="=SUM(1,2)" onCommit={vi.fn()} functions={[]} />)

    const box = screen.getByRole<HTMLInputElement>('textbox', { name: 'Formula bar' })
    await user.click(box)
    box.setSelectionRange(6, 6)

    await user.keyboard('{F4}')
    expect(box.value).toBe('=SUM(1,2)')
  })

  it('says what is being typed, so the sheet can box the cells it names', async () => {
    const user = userEvent.setup()
    const typing = vi.fn()
    render(<FormulaBar text="" onCommit={vi.fn()} onTyping={typing} functions={[]} />)

    const box = screen.getByRole('textbox', { name: 'Formula bar' })
    await user.click(box)
    await user.type(box, '=A1')

    expect(typing).toHaveBeenLastCalledWith('=A1')

    await user.tab()
    expect(typing).toHaveBeenLastCalledWith(null)
  })
})

/**
 * The colours behind the text, and the copy of the text they nearly cost.
 *
 * An `<input>` cannot hold colours, so a formula's references are drawn on a
 * mirror behind it and the input's own text is made transparent. Both halves
 * of that are conditional on the same thing, and for a while only one of them
 * was: anything that was not a formula was drawn twice, once by the input and
 * once by the mirror, a fraction of a line apart. On screen a cell holding a
 * sentence looked struck through by itself.
 *
 * jsdom draws nothing, so what is asserted is the cause rather than the look.
 * An input's value is not text content, so anything `getByText` can find is a
 * second copy of the words drawn behind the first.
 */
describe('the mirror behind the input', () => {
  it('is not there for text, which would otherwise be drawn twice', () => {
    bar({ text: 'Інтеграції та синхронізація' })

    expect(box().value).toBe('Інтеграції та синхронізація')
    expect(screen.queryByText('Інтеграції та синхронізація')).toBeNull()
  })

  it('is not there for a number either', () => {
    bar({ text: '1234.5' })

    expect(box().value).toBe('1234.5')
    expect(screen.queryByText('1234.5')).toBeNull()
  })

  it('is there for a formula, which is what it exists for', () => {
    bar({ text: '=SUM(A1:B2)+C3' })

    // The input holds the text and the mirror holds the pieces, so the
    // references are in the document as elements of their own.
    expect(screen.getByText('A1:B2')).toBeInTheDocument()
    expect(screen.getByText('C3')).toBeInTheDocument()
  })

  it('gives each reference of a formula a colour of its own', () => {
    bar({ text: '=A1+B2' })

    const first = screen.getByText('A1').getAttribute('style')
    const second = screen.getByText('B2').getAttribute('style')

    expect(first).toMatch(/color/u)
    expect(first).not.toBe(second)
  })
})
