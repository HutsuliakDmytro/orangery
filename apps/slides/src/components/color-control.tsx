import { useState } from 'react'
import { ColorPicker, isValidHex, normalizeHex, TEXT_COLOR_SWATCHES } from '@orangery/ui-kit'
import { colorContextFor } from '@orangery/ooxml-presentation'
import { resolveColor } from '@orangery/ooxml-drawingml'
import type { Color } from '@orangery/ooxml-drawingml'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * Choosing a colour: from the theme, from a short standard list, or any other.
 *
 * The theme row is the one that matters. A shape painted `accent1` means
 * "whatever this deck calls accent 1", so changing the theme repaints it;
 * a shape painted `#FF7A00` means that orange for ever, and will sit there
 * unchanged while everything around it turns blue. Both are things a person
 * might want, and until now only the second was on offer.
 *
 * The theme swatches are drawn in the colour the open deck resolves them to,
 * because "accent 3" says nothing on its own.
 */

/** The theme slots PowerPoint puts in its own palette, in its own order. */
const THEME_SLOTS = [
  ['lt1', 'Background 1'],
  ['tx1', 'Text 1'],
  ['lt2', 'Background 2'],
  ['tx2', 'Text 2'],
  ['accent1', 'Accent 1'],
  ['accent2', 'Accent 2'],
  ['accent3', 'Accent 3'],
  ['accent4', 'Accent 4'],
  ['accent5', 'Accent 5'],
  ['accent6', 'Accent 6'],
] as const

/** A handful of literals, for when the answer is "red" and not "the theme". */
const STANDARD = [
  '#000000',
  '#FFFFFF',
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#007AFF',
  '#AF52DE',
]

/** What the open deck draws a theme slot as, or null when it cannot say. */
function useThemeColors(): Map<string, string> {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)

  const resolved = new Map<string, string>()
  if (open === null || slide === null) return resolved

  const context = colorContextFor(open.deck, open.themes, slide)
  for (const [slot] of THEME_SLOTS) {
    const colour = resolveColor({ source: { kind: 'scheme', name: slot }, transforms: [] }, context)
    if (colour !== null) resolved.set(slot, colour.hex)
  }

  return resolved
}

export function ColorControl({
  label,
  selected,
  onPick,
  onClear,
}: {
  /** Names the group, and every swatch inside it, for a screen reader. */
  label: string
  /** The colour in force, as hex, for showing which swatch is on. */
  selected: string | null
  onPick: (color: Color) => void
  onClear: () => void
}) {
  const theme = useThemeColors()
  const [custom, setCustom] = useState(false)

  const swatch = (key: string, name: string, hex: string, color: Color) => (
    <button
      key={key}
      type="button"
      aria-label={`${label} ${name}`}
      aria-pressed={selected !== null && selected.toUpperCase() === hex.toUpperCase()}
      onClick={() => {
        onPick(color)
      }}
      style={{ background: hex }}
      className={`h-5 w-5 rounded border ${
        selected !== null && selected.toUpperCase() === hex.toUpperCase()
          ? 'border-accent'
          : 'border-border'
      }`}
    />
  )

  return (
    <div className="space-y-1">
      {theme.size > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={`${label} theme colours`} role="group">
          {THEME_SLOTS.map(([slot, name]) => {
            const hex = theme.get(slot)
            return hex === undefined
              ? null
              : swatch(slot, name, hex, { source: { kind: 'scheme', name: slot }, transforms: [] })
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {STANDARD.map((hex) =>
          swatch(hex, hex, hex, { source: { kind: 'srgb', hex }, transforms: [] }),
        )}
        <button
          type="button"
          aria-label={`${label} none`}
          onClick={onClear}
          className="h-5 rounded border border-border px-1.5 text-muted"
        >
          None
        </button>
        <button
          type="button"
          aria-label={`${label} custom`}
          onClick={() => {
            setCustom(true)
          }}
          className="h-5 rounded border border-border px-1.5 text-muted"
        >
          Custom…
        </button>
      </div>

      {custom && (
        <ColorPicker
          title={`${label} colour`}
          swatches={TEXT_COLOR_SWATCHES}
          resetLabel="No colour"
          onPick={(hex: string) => {
            const normalized = normalizeHex(hex)
            if (isValidHex(hex) && normalized !== null) {
              onPick({ source: { kind: 'srgb', hex: normalized }, transforms: [] })
            }
          }}
          onReset={onClear}
          onClose={() => {
            setCustom(false)
          }}
        />
      )}
    </div>
  )
}
