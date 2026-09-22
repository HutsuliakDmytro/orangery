import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { useViewStore } from '../../store/view-store'
import { runCommand } from '@orangery/ui-kit'
import { serializeDocument } from '../../ooxml/serialize-document'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'
import { CAPTION_STYLE_ID } from './caption'

let editor: Editor

beforeEach(() => {
  useViewStore.setState({ headingNumbering: null })
  editor = createTestEditor('<p>a picture</p>')
})

afterEach(() => {
  editor.destroy()
  useViewStore.setState({ headingNumbering: null })
})

/** The labels the editor draws in front of the captions. */
const labels = () =>
  [...editor.view.dom.querySelectorAll('.caption-label')].map((element) => element.textContent)

const write = () =>
  serializeDocument(editor.getJSON() as ProseMirrorNodeJson, {
    documentAttributes: {},
    sectionProperties: null,
    captionsByChapter: useViewStore.getState().headingNumbering !== null,
  })

describe('inserting a caption', () => {
  it('adds a paragraph after the block being captioned', () => {
    runCommand('insert.figure-caption', { editor })

    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(1).attrs['captionKind']).toBe('figure')
  })

  it('marks it with the style Word uses for captions', () => {
    runCommand('insert.figure-caption', { editor })
    expect(editor.state.doc.child(1).attrs['styleId']).toBe(CAPTION_STYLE_ID)
  })

  it('leaves the cursor in the caption, ready for the description', () => {
    runCommand('insert.table-caption', { editor })
    editor.commands.insertContent('what it shows')

    expect(editor.state.doc.child(1).textContent).toBe('what it shows')
  })
})

describe('the number the editor draws', () => {
  it('counts each kind on its own', () => {
    runCommand('insert.figure-caption', { editor })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    runCommand('insert.table-caption', { editor })

    expect(labels()).toEqual(['Figure 1 — ', 'Table 1 — '])
  })

  it('renumbers when a caption is added in front', () => {
    runCommand('insert.figure-caption', { editor })
    editor.commands.setTextSelection(1)
    runCommand('insert.figure-caption', { editor })

    expect(labels()).toEqual(['Figure 1 — ', 'Figure 2 — '])
  })

  it('counts within the chapter once the chapters are numbered', () => {
    useViewStore.setState({ headingNumbering: 'decimal' })
    editor.commands.setContent('<h1>One</h1><p>x</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    runCommand('insert.figure-caption', { editor })

    expect(labels()).toEqual(['Figure 1.1 — '])
  })

  it('keeps the number out of the text of the document', () => {
    runCommand('insert.figure-caption', { editor })
    editor.commands.insertContent('the description')

    expect(editor.state.doc.textContent).toBe('a picturethe description')
  })
})

describe('writing a caption to the file', () => {
  it('writes the number as a field Word can recalculate', () => {
    runCommand('insert.figure-caption', { editor })
    const xml = write()

    // A number written as plain text would be wrong the moment a figure is
    // inserted above it, which is what the field exists to prevent.
    expect(xml).toContain('SEQ Figure \\* ARABIC')
    expect(xml).toContain('w:fldCharType="begin"')
    expect(xml).toContain(`<w:pStyle w:val="${CAPTION_STYLE_ID}"/>`)
  })

  it('caches the number it shows, for a reader that cannot calculate', () => {
    runCommand('insert.figure-caption', { editor })
    editor.commands.setTextSelection(1)
    runCommand('insert.figure-caption', { editor })

    const xml = write()
    expect(xml).toContain('<w:t xml:space="preserve">1</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">2</w:t>')
  })

  it('restarts the count at each chapter when the chapters are numbered', () => {
    useViewStore.setState({ headingNumbering: 'decimal' })
    editor.commands.setContent('<h1>One</h1><p>x</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    runCommand('insert.figure-caption', { editor })

    const xml = write()
    expect(xml).toContain('SEQ Figure \\* ARABIC \\s 1')
    expect(xml).toContain('STYLEREF 1 \\s')
  })

  it('writes no field for an ordinary paragraph', () => {
    expect(write()).not.toContain('SEQ')
  })
})
