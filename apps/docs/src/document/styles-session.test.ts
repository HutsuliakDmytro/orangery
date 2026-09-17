import { getPartText } from '@orangery/ooxml-core'
import { STYLES_PART } from '../ooxml/parts'
import { describe, expect, it } from 'vitest'
import { createTestEditor, selectText } from '../test/editor-harness'
import { createNewDocx } from './docx-file'
import { parseStyles } from '../ooxml/styles'
import { formattingAt, newStyleFrom, saveStyle } from './styles-session'

describe('formattingAt', () => {
  it('reads the marks the selection wears', () => {
    const editor = createTestEditor('<p>hello world</p>')
    selectText(editor, 'hello')
    editor.commands.toggleBold()
    editor.commands.setFontSize(14)

    const formatting = formattingAt(editor, 'paragraph')
    expect(formatting.bold).toBe(true)
    expect(formatting.fontSize).toBe(14)
    editor.destroy()
  })

  it('reads the block properties for a paragraph style', () => {
    const editor = createTestEditor('<p>text</p>')
    editor.commands.updateAttributes('paragraph', { textAlign: 'center', spaceAfter: 6 })

    const formatting = formattingAt(editor, 'paragraph')
    expect(formatting.textAlign).toBe('center')
    expect(formatting.spaceAfter).toBe(6)
    editor.destroy()
  })

  it('leaves the block properties out of a character style', () => {
    // A character style says nothing about the paragraph it sits in.
    const editor = createTestEditor('<p>text</p>')
    editor.commands.updateAttributes('paragraph', { textAlign: 'center' })
    editor.commands.toggleBold()

    const formatting = formattingAt(editor, 'character')
    expect(formatting.bold).toBe(true)
    expect(formatting.textAlign).toBeUndefined()
    editor.destroy()
  })
})

describe('saving a style', () => {
  it('puts it in the package where the file keeps its styles', async () => {
    const document = await createNewDocx()
    const editor = createTestEditor('<p>text</p>')
    editor.commands.toggleBold()

    const definition = newStyleFrom(document.pkg, editor, 'Pull Quote', 'paragraph')
    const saved = saveStyle(document.pkg, definition)

    expect(saved?.catalogue.styles.get('PullQuote')?.name).toBe('Pull Quote')
    expect(getPartText(document.pkg, STYLES_PART)).toContain('w:styleId="PullQuote"')
    editor.destroy()
  })

  it('bases a new paragraph style on the document default', async () => {
    // So it inherits the document's own fonts and spacing rather than Word's.
    const document = await createNewDocx()
    const editor = createTestEditor('<p>text</p>')

    const definition = newStyleFrom(document.pkg, editor, 'Quote', 'paragraph')
    expect(definition.basedOn).toBe('Normal')
    editor.destroy()
  })

  it('does not hand out an id another style is using', async () => {
    const document = await createNewDocx()
    const editor = createTestEditor('<p>text</p>')

    expect(newStyleFrom(document.pkg, editor, 'Normal', 'paragraph').id).toBe('Normal1')
    editor.destroy()
  })

  it('rewrites a style rather than adding a second with the same id', async () => {
    const document = await createNewDocx()
    const editor = createTestEditor('<p>text</p>')
    editor.commands.toggleBold()

    const definition = newStyleFrom(document.pkg, editor, 'Quote', 'paragraph')
    saveStyle(document.pkg, definition)
    saveStyle(document.pkg, { ...definition, formatting: { italic: true } })

    const xml = getPartText(document.pkg, STYLES_PART) ?? ''
    expect(xml.match(/w:styleId="Quote"/gu)).toHaveLength(1)
    expect(parseStyles(xml).styles.get('Quote')?.own.italic).toBe(true)
    editor.destroy()
  })

  it('reports nothing for a document with no styles part to write into', async () => {
    const document = await createNewDocx()
    const editor = createTestEditor('<p>text</p>')
    const definition = newStyleFrom(document.pkg, editor, 'Quote', 'paragraph')

    document.pkg.parts.delete(STYLES_PART)
    expect(saveStyle(document.pkg, definition)).toBeNull()
    editor.destroy()
  })
})
