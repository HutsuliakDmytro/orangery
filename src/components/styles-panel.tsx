import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { useStylesStore } from '../store/styles-store'
import { PickerPopover } from './picker-popover'
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
