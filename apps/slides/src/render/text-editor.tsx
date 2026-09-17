import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { useEffect } from 'react'
import { FontSize, OoxmlParagraph, PreservedRunProperties } from '@orangery/editor-text'
import type { PmNode } from '@orangery/ooxml-drawingml'
import { useEditorStore } from '../store/editor-store'

/**
 * Editing the text inside one shape.
 *
 * A ProseMirror instance per shape being edited, not per shape on the slide:
 * a deck with forty text boxes would otherwise build forty editors to show one
 * slide. It is created when a shape is entered and destroyed when it is left.
 *
 * The document goes in as the JSON the OOXML bridge produced and comes back the
 * same way, so what the editor does not understand — a run's language, its
 * highlight, its extension list — rides along on the preserved mark and is
 * written back with it.
 */
export function TextEditor({
  doc,
  onCommit,
  onCancel,
}: {
  doc: PmNode
  /** Called with the edited document when the shape is left. */
  onCommit: (doc: PmNode) => void
  onCancel: () => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // A slide's text box holds paragraphs, not headings and lists — those
        // are the outline levels, which the bridge carries as an attribute.
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      OoxmlParagraph,
      PreservedRunProperties,
    ],
    content: doc as never,
    autofocus: 'end',
    onTransaction: () => {
      // What a formatting command can do depends on where the cursor is, so the
      // registry is told something moved.
      useEditorStore.getState().touch()
    },
    editorProps: {
      attributes: { class: 'slide-text' },
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Escape') return false
        event.preventDefault()
        onCancel()
        return true
      },
    },
  })

  // Published so the registry's formatting commands can reach it.
  useEffect(() => {
    useEditorStore.getState().set(editor)
    return () => {
      useEditorStore.getState().set(null)
    }
  }, [editor])

  // Committed on unmount rather than on blur: leaving the shape is what ends
  // the edit, and a blur fires for a toolbar click too.
  useEffect(() => {
    return () => {
      if (editor !== null) onCommit(editor.getJSON() as PmNode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return <EditorContent editor={editor} />
}
