import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { runCommand } from '@orangery/ui-kit'
import { serializeDocument } from '../../ooxml/serialize-document'
import { parseDocument } from '../../ooxml/parse-document'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'
import { DEFAULT_SECTION, withOrientation } from '../../ooxml/section'
import { useViewStore } from '../../store/view-store'

let editor: Editor

beforeEach(() => {
  useViewStore.setState({
    section: { ...DEFAULT_SECTION, margins: { ...DEFAULT_SECTION.margins } },
  })
  editor = createTestEditor('<p>one</p><p>two</p>')
})

afterEach(() => {
  editor.destroy()
})

const write = () =>
  serializeDocument(editor.getJSON() as ProseMirrorNodeJson, {
    documentAttributes: {},
    sectionProperties: null,
  })

describe('inserting a section break', () => {
  it('puts a block after the paragraph the cursor is in', () => {
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    expect(editor.state.doc.child(1).type.name).toBe('sectionBreak')
  })

  it('carries the page setup the document has now', () => {
    useViewStore.setState({ section: withOrientation(DEFAULT_SECTION, 'landscape') })
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    expect(editor.state.doc.child(1).attrs['sectPr']).toContain('w:orient="landscape"')
  })

  it('shows itself, so it can be found and removed', () => {
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    expect(editor.view.dom.querySelector('.section-break')).not.toBeNull()
  })

  it('is one block, so a single delete takes it out', () => {
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })
    const before = editor.state.doc.childCount

    editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize)
    editor.commands.deleteSelection()

    expect(editor.state.doc.childCount).toBe(before - 1)
  })
})

describe('a section break in the file', () => {
  it('lands on the paragraph in front of it, where OOXML keeps it', () => {
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    const xml = write()
    expect(xml).toContain('<w:pPr><w:sectPr>')
  })

  it('comes back as a break when the document is read again', () => {
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    const { doc } = parseDocument(write())
    expect(doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'sectionBreak',
      'paragraph',
    ])
  })
})

describe('a break at the end of the document', () => {
  it('leaves a paragraph to type the new section into', () => {
    // An atom is not somewhere a caret can go, so a break with nothing after it
    // would start a section the user cannot reach.
    editor.commands.setContent('<p>only</p>')
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    expect(editor.state.doc.child(2).type.name).toBe('paragraph')
  })

  it('puts the cursor in it, in the section just started', () => {
    editor.commands.setContent('<p>only</p>')
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })
    editor.commands.insertContent('after the break')

    expect(editor.state.doc.child(2).textContent).toBe('after the break')
  })

  it('adds nothing when there is already a paragraph after it', () => {
    editor.commands.setContent('<p>one</p><p>two</p>')
    editor.commands.setTextSelection(2)
    runCommand('insert.section-break', { editor })

    expect(editor.state.doc.childCount).toBe(3)
  })
})
