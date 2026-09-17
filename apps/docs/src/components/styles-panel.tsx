import type { OoxmlPackage } from '@orangery/ooxml-core'
import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { formattingAt, newStyleFrom, saveStyle } from '../document/styles-session'
import { getSession } from '../document/session'
import { useDocumentStore } from '../store/document-store'
import { useStylesStore } from '../store/styles-store'
import { PickerPopover } from './picker-popover'
import type { StyleDefinition } from '../ooxml/style-writer'
import type { StyleOption } from '../store/styles-store'

/** Mirrors Tiptap's `Level`; declared locally so the heading package stays transitive. */
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * The document's styles, and what the selection is wearing.
 *
 * The list comes from the file rather than from a fixed set: a document defines
 * its own styles, and offering one it does not have would leave Word rendering
 * the text as though it had no style at all.
 */
export function StylesPanel({ onClose }: { onClose: () => void }) {
  const { editor } = useCurrentEditor()
  const [newName, setNewName] = useState('')
  const paragraphStyles = useStylesStore((state) => state.options)
  const characterStyles = useStylesStore((state) => state.characterOptions)

  /**
   * What the selection is wearing, as one string.
   *
   * A pair of strings rather than an object, so the default comparison is
   * enough: an object would be a new one on every keystroke and re-render the
   * whole list for nothing.
   */
  const wearing =
    useEditorState({
      editor: editor ?? null,
      selector: ({ editor: instance }) => {
        if (!instance) return '\u0000'

        const block = instance.isActive('heading') ? 'heading' : 'paragraph'
        const paragraph: unknown = instance.getAttributes(block)['styleId']
        const character: unknown = instance.getAttributes('characterStyle')['styleId']

        return `${typeof paragraph === 'string' ? paragraph : ''}\u0000${
          typeof character === 'string' ? character : ''
        }`
      },
    }) ?? '\u0000'

  const [paragraphStyle = '', characterStyle = ''] = wearing.split('\u0000')

  /**
   * Writes a style into the document and refreshes what the panel offers.
   *
   * The catalogue is rebuilt from the file rather than patched: it is what the
   * dropdown and this panel both read, and a copy that drifts offers styles the
   * document no longer has.
   */
  const writeStyle = (
    build: (pkg: OoxmlPackage, instance: Editor) => StyleDefinition,
  ): StyleDefinition | null => {
    const session = getSession()
    if (session?.kind !== 'docx' || !editor) return null

    const saved = saveStyle(session.docx.pkg, build(session.docx.pkg, editor))
    if (saved === null) return null

    useStylesStore.getState().setCatalogue(saved.catalogue)
    useDocumentStore.getState().markDirty()
    return saved.definition
  }

  /** The style being updated, as it stands, so only its formatting changes. */
  const definitionOf = (styleId: string): StyleDefinition => {
    const existing = useStylesStore.getState().catalogue?.styles.get(styleId)

    return {
      id: styleId,
      name: existing?.name ?? styleId,
      type: existing?.type ?? 'paragraph',
      basedOn: existing?.basedOn ?? null,
      next: existing?.next ?? null,
      formatting: {},
    }
  }

  const applyParagraph = (style: StyleOption) => {
    if (!editor) return

    const chain = editor.chain().focus()
    if (style.headingLevel === null) chain.setParagraph().setParagraphStyle(style.id)
    else chain.setHeading({ level: style.headingLevel as HeadingLevel })
    chain.run()
  }

  return (
    <PickerPopover title="Styles" onClose={onClose}>
      <div className="flex max-h-96 w-64 flex-col gap-3 overflow-y-auto">
        <section className="flex flex-col gap-1">
          <h3 className="text-xs uppercase tracking-wide text-muted">Paragraph</h3>
          {paragraphStyles.map((style) => (
            <StyleRow
              key={style.id}
              label={style.label}
              active={paragraphStyle === style.id}
              onApply={() => {
                applyParagraph(style)
              }}
            />
          ))}
        </section>

        {characterStyles.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-xs uppercase tracking-wide text-muted">Character</h3>
            {characterStyles.map((style) => (
              <StyleRow
                key={style.id}
                label={style.label}
                active={characterStyle === style.id}
                onApply={() => {
                  // Running the style already on the selection takes it off,
                  // which is the only way back to no character style at all.
                  const chain = editor?.chain().focus()
                  if (characterStyle === style.id) chain?.unsetCharacterStyle().run()
                  else chain?.setCharacterStyle(style.id).run()
                }}
              />
            ))}
          </section>
        )}
        <section className="flex flex-col gap-2 border-t border-border pt-2">
          <button
            type="button"
            disabled={paragraphStyle === ''}
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              writeStyle((_pkg, instance) => ({
                ...definitionOf(paragraphStyle),
                formatting: formattingAt(instance, 'paragraph'),
              }))
            }}
            className="rounded border border-border px-2 py-1 text-sm text-text disabled:opacity-40"
          >
            {paragraphStyle === ''
              ? 'Update style to match'
              : `Update ${paragraphStyle} to match selection`}
          </button>

          <div className="flex gap-1">
            <input
              value={newName}
              placeholder="New style from selection"
              aria-label="New style name"
              onChange={(event) => {
                setNewName(event.target.value)
              }}
              className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
            />
            <button
              type="button"
              disabled={newName.trim() === ''}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                const name = newName.trim()
                const created = writeStyle((pkg, instance) =>
                  newStyleFrom(pkg, instance, name, 'paragraph'),
                )

                if (created !== null) {
                  editor?.chain().focus().setParagraphStyle(created.id).run()
                  setNewName('')
                }
              }}
              className="rounded bg-accent px-2 py-1 text-sm text-black disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </section>
      </div>
    </PickerPopover>
  )
}

function StyleRow({
  label,
  active,
  onApply,
}: {
  label: string
  active: boolean
  onApply: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onMouseDown={(event) => {
        // The editor keeps focus, so the selection the style applies to is still
        // there when the click lands.
        event.preventDefault()
      }}
      onClick={onApply}
      className={`rounded px-2 py-1 text-left text-sm ${
        active ? 'bg-accent-soft text-text' : 'text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}
