import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorContext, useEditor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerBuiltinCommands } from '../editor/commands/definitions'
import { buildExtensions } from '../editor/extension-set'
import { parseStyles } from '../ooxml/styles'
import { useStylesStore } from '../store/styles-store'
import { Toolbar } from './toolbar'

const STYLES = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>
</w:styles>`

function Wrapper({ children }: { children: ReactNode }) {
  // The production extension set, so the toolbar sees the real command state.
  const editor = useEditor({ extensions: buildExtensions(), content: '<p>hello</p>' })
  const value = useMemo(() => ({ editor }), [editor])
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

const renderToolbar = () => render(<Toolbar />, { wrapper: Wrapper })

beforeEach(() => {
  registerBuiltinCommands()
  useStylesStore.getState().setCatalogue(parseStyles(STYLES))
})

describe('accessibility', () => {
  it('is announced as a toolbar with a name', async () => {
    renderToolbar()
    expect(await screen.findByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
  })

  it('exposes one Tab stop rather than one per control', async () => {
    renderToolbar()
    const toolbar = await screen.findByRole('toolbar')

    await waitFor(() => {
      const reachable = [...toolbar.querySelectorAll<HTMLElement>('button, select')].filter(
        (element) => element.tabIndex === 0,
      )
      expect(reachable).toHaveLength(1)
    })
  })

  it('moves between controls with the arrow keys', async () => {
    const user = userEvent.setup()
    renderToolbar()
    const toolbar = await screen.findByRole('toolbar')

    // Undo and redo start disabled, so the rove begins at the first control
    // that can actually take focus.
    const enabled = [...toolbar.querySelectorAll<HTMLElement>('button, select')].filter(
      (element) => !element.hasAttribute('disabled'),
    )
    const first = enabled[0]
    if (!first) throw new Error('no enabled toolbar controls')

    first.focus()
    await user.keyboard('{ArrowRight}')

    expect(document.activeElement).toBe(enabled[1])
  })

  it('jumps to the last control with End', async () => {
    const user = userEvent.setup()
    renderToolbar()
    const toolbar = await screen.findByRole('toolbar')

    const enabled = [...toolbar.querySelectorAll<HTMLElement>('button, select')].filter(
      (element) => !element.hasAttribute('disabled'),
    )

    enabled[0]?.focus()
    await user.keyboard('{End}')

    expect(document.activeElement).toBe(enabled.at(-1))
  })

  it('gives every button an accessible name', async () => {
    renderToolbar()
    const toolbar = await screen.findByRole('toolbar')

    for (const button of within(toolbar).getAllByRole('button')) {
      expect(button).toHaveAccessibleName()
    }
  })

  it('reports toggle state through aria-pressed', async () => {
    renderToolbar()
    const bold = await screen.findByRole('button', { name: 'Bold' })
    expect(bold).toHaveAttribute('aria-pressed')
  })
})

describe('style dropdown', () => {
  it('lists the styles the open document defines', async () => {
    renderToolbar()
    const select = await screen.findByLabelText('Paragraph style')

    expect(within(select).getByRole('option', { name: 'Quote' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'heading 1' })).toBeInTheDocument()
  })

  it('puts the familiar styles first', async () => {
    renderToolbar()
    const select = await screen.findByLabelText('Paragraph style')
    const options = within(select).getAllByRole('option')

    expect(options[0]).toHaveTextContent('Normal')
  })

  it('shows nothing when the document has no catalogue', async () => {
    useStylesStore.getState().setCatalogue(null)
    renderToolbar()

    const select = await screen.findByLabelText('Paragraph style')
    expect(within(select).queryAllByRole('option')).toHaveLength(0)
  })
})
