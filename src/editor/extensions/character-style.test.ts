import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor, selectText } from '../../test/editor-harness'
import { serializeDocument } from '../../ooxml/serialize-document'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<p>hello world</p>')
})

afterEach(() => {
  editor.destroy()
})

const styleOf = (): unknown => editor.getAttributes('characterStyle')['styleId']

const write = () =>
  serializeDocument(editor.getJSON() as ProseMirrorNodeJson, {
    documentAttributes: {},
    sectionProperties: null,
    alwaysPreserveSpace: false,
  })

describe('applying a character style', () => {
  it('marks the selection with it', () => {
    selectText(editor, 'hello')
    editor.commands.setCharacterStyle('Emphasis')

    expect(styleOf()).toBe('Emphasis')
  })

  it('leaves the rest of the paragraph alone', () => {
    selectText(editor, 'hello')
    editor.commands.setCharacterStyle('Emphasis')

    editor.commands.setTextSelection(editor.state.doc.content.size - 2)
    expect(styleOf()).toBeUndefined()
  })

  it('replaces one style with another rather than wearing both', () => {
    selectText(editor, 'hello')
    editor.commands.setCharacterStyle('Emphasis')
    editor.commands.setCharacterStyle('Strong')

    expect(styleOf()).toBe('Strong')
    expect(write().match(/w:rStyle/gu)).toHaveLength(1)
  })

  it('comes off again', () => {
    selectText(editor, 'hello')
    editor.commands.setCharacterStyle('Emphasis')
    editor.commands.unsetCharacterStyle()

    expect(styleOf()).toBeUndefined()
    expect(write()).not.toContain('w:rStyle')
  })

  it('sits beside the formatting the run states itself', () => {
    selectText(editor, 'hello')
    editor.commands.setCharacterStyle('Emphasis')
    editor.commands.toggleBold()

    const xml = write()
    expect(xml).toContain('<w:rStyle w:val="Emphasis"/>')
    expect(xml).toContain('<w:b/>')
  })

  it('is not taken off by clearing the formatting of the run', () => {
    // A character style names what the run is; clearing how it looks should not
    // quietly rename it.
    selectText(editor, 'hello')
    editor.commands.setCharacterStyle('Emphasis')
    editor.commands.toggleBold()

    selectText(editor, 'hello')
    editor.commands.unsetMark('bold')

    expect(styleOf()).toBe('Emphasis')
  })
})
