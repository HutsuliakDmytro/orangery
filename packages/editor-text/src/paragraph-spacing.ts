import { Extension } from '@tiptap/core'

/**
 * Line spacing and space before/after, mapping onto OOXML `w:spacing`.
 *
 * Word stores `w:line` in 240ths of a line and `w:before`/`w:after` in twips;
 * they are kept here as a multiplier and as points respectively, and converted
 * on export. See CLAUDE.md — the schema follows OOXML concepts, not HTML.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphSpacing: {
      setLineHeight: (multiplier: number) => ReturnType
      unsetLineHeight: () => ReturnType
      setParagraphSpacing: (spacing: { before?: number; after?: number }) => ReturnType
      unsetParagraphSpacing: () => ReturnType
    }
  }
}

/** The values Google Docs offers in its line-spacing menu. */
export const LINE_HEIGHT_PRESETS = [1, 1.15, 1.5, 2, 2.5, 3] as const

export const DEFAULT_LINE_HEIGHT = 1.15

export const MIN_LINE_HEIGHT = 0.5
export const MAX_LINE_HEIGHT = 10

export function clampLineHeight(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LINE_HEIGHT
  const rounded = Math.round(value * 100) / 100
  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, rounded))
}

/** Word rejects negative spacing; the upper bound is one page at 72pt/inch. */
export function clampSpacing(points: number): number {
  if (!Number.isFinite(points)) return 0
  return Math.min(1584, Math.max(0, Math.round(points * 2) / 2))
}

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export interface ParagraphSpacingOptions {
  types: string[]
}

export const ParagraphSpacing = Extension.create<ParagraphSpacingOptions>({
  name: 'paragraphSpacing',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => parseNumber(element.style.lineHeight),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['lineHeight']
              if (typeof value !== 'number') return {}
              return { style: `line-height: ${String(value)}` }
            },
          },
          spaceBefore: {
            default: null,
            parseHTML: (element: HTMLElement) => parseNumber(element.style.marginTop),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['spaceBefore']
              if (typeof value !== 'number') return {}
              return { style: `margin-top: ${String(value)}pt` }
            },
          },
          spaceAfter: {
            default: null,
            parseHTML: (element: HTMLElement) => parseNumber(element.style.marginBottom),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['spaceAfter']
              if (typeof value !== 'number') return {}
              return { style: `margin-bottom: ${String(value)}pt` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setLineHeight:
        (multiplier: number) =>
        ({ commands }) =>
          this.options.types.every((type) =>
            commands.updateAttributes(type, { lineHeight: clampLineHeight(multiplier) }),
          ),

      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types.every((type) => commands.resetAttributes(type, 'lineHeight')),

      setParagraphSpacing:
        (spacing: { before?: number; after?: number }) =>
        ({ commands }) => {
          const attributes: Record<string, number> = {}
          if (spacing.before !== undefined) attributes['spaceBefore'] = clampSpacing(spacing.before)
          if (spacing.after !== undefined) attributes['spaceAfter'] = clampSpacing(spacing.after)
          return this.options.types.every((type) => commands.updateAttributes(type, attributes))
        },

      unsetParagraphSpacing:
        () =>
        ({ commands }) =>
          this.options.types.every((type) =>
            commands.resetAttributes(type, ['spaceBefore', 'spaceAfter']),
          ),
    }
  },
})
