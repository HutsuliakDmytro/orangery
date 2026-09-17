import { Extension } from '@tiptap/core'
// Imported for its declaration merging, not for a value: the size is an
// attribute of the `textStyle` mark, and `removeEmptyTextStyle` is that
// extension's command. Without this the chain below has no type for it.
import '@tiptap/extension-text-style'

/**
 * Font size as a `TextStyle` attribute.
 *
 * Tiptap ships no font-size extension, and the OOXML model measures it in
 * half-points (`w:sz`), so sizes are kept as whole points here and halved on
 * export — see CLAUDE.md "ProseMirror schema is modelled on OOXML concepts".
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: number) => ReturnType
      unsetFontSize: () => ReturnType
    }
  }
}

/** Word's own dropdown values. The size input accepts anything in range. */
export const FONT_SIZE_PRESETS = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72,
] as const

export const DEFAULT_FONT_SIZE = 11

/** Word rejects sizes outside this range; matching it avoids unexportable documents. */
export const MIN_FONT_SIZE = 1
export const MAX_FONT_SIZE = 1638

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE
  // OOXML stores half-points, so half a point is the smallest representable step.
  const rounded = Math.round(size * 2) / 2
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, rounded))
}

export function parseFontSize(value: string | null): number | null {
  if (!value) return null
  const match = /^(\d+(?:\.\d+)?)\s*pt$/.exec(value.trim())
  if (!match?.[1]) return null
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export interface FontSizeOptions {
  /** Marks the attribute is attached to. `textStyle` mirrors an OOXML run. */
  types: string[]
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle'],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => parseFontSize(element.style.fontSize),
            renderHTML: (attributes: Record<string, unknown>) => {
              const size = attributes['fontSize']
              if (typeof size !== 'number') return {}
              return { style: `font-size: ${String(size)}pt` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setFontSize:
        (size: number) =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { fontSize: clampFontSize(size) })
            .run(),

      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})
