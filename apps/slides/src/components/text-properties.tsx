import { useEditorStore } from '../store/editor-store'

/**
 * The typeface and size of the text being edited.
 *
 * The two theme fonts come first and are written as `+mj-lt` and `+mn-lt`
 * rather than as the family they resolve to today. That is the difference
 * between "this heading is the heading font" and "this heading is Inter": the
 * first follows the deck when its theme changes, and the second is a decision
 * that outlives the reason for it.
 *
 * It acts on the editor rather than the shape: a run is a stretch of the
 * selection, not a property of the box around it.
 */

/** `+mj-lt` and `+mn-lt` are how a deck spells its two theme fonts. */
const THEME_FONTS = [
  ['+mj-lt', 'Heading'],
  ['+mn-lt', 'Body'],
] as const

/** What the app ships with, so a deck made here opens the same way elsewhere. */
const BUNDLED = ['Inter', 'Carlito', 'Liberation Sans', 'Liberation Serif']

export function TextProperties() {
  const editor = useEditorStore((state) => state.editor)
  if (editor === null) return null

  const style = editor.getAttributes('textStyle')
  const family = typeof style['fontFamily'] === 'string' ? style['fontFamily'] : ''
  const size = typeof style['fontSize'] === 'number' ? style['fontSize'] : ''

  const set = (attributes: Record<string, unknown>) => {
    editor.chain().focus().setMark('textStyle', attributes).run()
  }

  // A run may name a font the deck was built with and this app does not ship;
  // showing it is the only way the picker can say what is actually set.
  const others = family !== '' && !BUNDLED.includes(family) ? [family] : []

  return (
    <section aria-label="Text" className="space-y-2">
      <h2 className="uppercase tracking-wide text-muted">Text</h2>
      <div className="flex items-center gap-2">
        <select
          aria-label="Font"
          value={family}
          onChange={(event) => {
            set({ fontFamily: event.target.value })
          }}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-text"
        >
          <option value="">Inherited</option>
          {THEME_FONTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {[...others, ...BUNDLED].map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
        <input
          type="number"
          aria-label="Font size"
          value={size}
          min={1}
          max={400}
          step={1}
          onChange={(event) => {
            const points = Number(event.target.value)
            if (points > 0) set({ fontSize: points })
          }}
          className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-text"
        />
      </div>
    </section>
  )
}
