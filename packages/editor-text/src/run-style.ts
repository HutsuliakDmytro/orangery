import { Extension } from '@tiptap/core'
// Imported for its declaration merging, not for a value: these are attributes
// of the `textStyle` mark, which that extension defines.
import '@tiptap/extension-text-style'

/**
 * The rest of what an OOXML run says about its characters.
 *
 * Colour, highlight, capitals and letter spacing are run properties in both
 * formats — `w:color`/`a:solidFill`, `w:caps`/`a:cap`, `w:spacing`/`a:spc` — so
 * they belong on the same mark as the size and the typeface rather than in
 * either app.
 *
 * Colours are held as a hex string and only ever a hex string. A theme colour
 * is `accent1`, which has no place in a mark shaped like CSS; the converters
 * keep it where it was written and never bring it across, so a run painted from
 * the theme keeps following it.
 */

export type Capitals = 'all' | 'small'

/** `a:spc` and `w:spacing` both measure it in points, negative allowed. */
export const MIN_LETTER_SPACING = -10
export const MAX_LETTER_SPACING = 100

export function clampLetterSpacing(points: number): number {
  if (!Number.isFinite(points)) return 0
  const rounded = Math.round(points * 100) / 100
  return Math.min(MAX_LETTER_SPACING, Math.max(MIN_LETTER_SPACING, rounded))
}

/**
 * A colour as six hex digits, from either spelling.
 *
 * A browser hands back `rgb(255, 122, 0)` for a style it parsed, so reading
 * only `#RRGGBB` would lose every colour that came in through the DOM — which
 * is every colour that arrives by paste.
 */
const hex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (/^#[0-9A-Fa-f]{6}$/u.test(trimmed)) return trimmed.toUpperCase()

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(trimmed)
  if (rgb === null) return null

  return `#${rgb
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

export interface RunStyleOptions {
  /** Marks the attributes are attached to. `textStyle` mirrors a run. */
  types: string[]
}

export const RunStyle = Extension.create<RunStyleOptions>({
  name: 'runStyle',

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
          color: {
            default: null,
            parseHTML: (element: HTMLElement) => hex(element.style.color),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = hex(attributes['color'])
              return value === null ? {} : { style: `color: ${value}` }
            },
          },
          highlight: {
            default: null,
            parseHTML: (element: HTMLElement) => hex(element.style.backgroundColor),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = hex(attributes['highlight'])
              return value === null ? {} : { style: `background-color: ${value}` }
            },
          },
          caps: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.style.fontVariantCaps || element.style.textTransform
              if (value === 'small-caps') return 'small'
              return value === 'uppercase' ? 'all' : null
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['caps']
              if (value === 'all') return { style: 'text-transform: uppercase' }
              return value === 'small' ? { style: 'font-variant-caps: small-caps' } : {}
            },
          },
          letterSpacing: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const match = /^(-?\d+(?:\.\d+)?)pt$/u.exec(element.style.letterSpacing.trim())
              return match?.[1] === undefined ? null : Number(match[1])
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['letterSpacing']
              if (typeof value !== 'number') return {}
              return { style: `letter-spacing: ${String(clampLetterSpacing(value))}pt` }
            },
          },
        },
      },
    ]
  },
})
