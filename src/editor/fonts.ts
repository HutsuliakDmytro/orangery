/**
 * Font list.
 *
 * Bundled families are listed first: once their files ship (an Update 1 task in
 * PLAN.md) they are the only ones guaranteed to render identically on every OS
 * (CLAUDE.md "Known hard problems"). Until then they fall back to the system
 * stack like any other family. System families follow: they are what users expect
 * in a Word-compatible picker, and a DOCX that names one must keep naming it even
 * where it is unavailable.
 */

export interface FontOption {
  /** The family name as it is written into the document — never localised. */
  family: string
  label: string
  /** CSS stack used for rendering only. */
  stack: string
  bundled: boolean
}

export const BUNDLED_FONTS: readonly FontOption[] = [
  { family: 'Inter', label: 'Inter', stack: 'Inter, system-ui, sans-serif', bundled: true },
  {
    family: 'Liberation Serif',
    label: 'Liberation Serif',
    stack: "'Liberation Serif', 'Times New Roman', serif",
    bundled: true,
  },
  {
    family: 'Liberation Sans',
    label: 'Liberation Sans',
    stack: "'Liberation Sans', Arial, sans-serif",
    bundled: true,
  },
  {
    family: 'Liberation Mono',
    label: 'Liberation Mono',
    stack: "'Liberation Mono', 'Courier New', monospace",
    bundled: true,
  },
]

/** Families Word offers by default; metric-compatible substitutes exist for all. */
export const SYSTEM_FONTS: readonly FontOption[] = [
  { family: 'Arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', bundled: false },
  {
    family: 'Times New Roman',
    label: 'Times New Roman',
    stack: "'Times New Roman', Times, serif",
    bundled: false,
  },
  {
    family: 'Calibri',
    label: 'Calibri',
    stack: "Calibri, 'Liberation Sans', sans-serif",
    bundled: false,
  },
  {
    family: 'Cambria',
    label: 'Cambria',
    stack: "Cambria, 'Liberation Serif', serif",
    bundled: false,
  },
  { family: 'Georgia', label: 'Georgia', stack: 'Georgia, serif', bundled: false },
  { family: 'Verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif', bundled: false },
  {
    family: 'Courier New',
    label: 'Courier New',
    stack: "'Courier New', Courier, monospace",
    bundled: false,
  },
  {
    family: 'Helvetica',
    label: 'Helvetica',
    stack: 'Helvetica, Arial, sans-serif',
    bundled: false,
  },
]

export const ALL_FONTS: readonly FontOption[] = [...BUNDLED_FONTS, ...SYSTEM_FONTS]

export const DEFAULT_FONT_FAMILY = 'Arial'

export function findFont(family: string): FontOption | undefined {
  return ALL_FONTS.find((font) => font.family.toLowerCase() === family.toLowerCase())
}

/** CSS value for a family that may not be in the list — an imported DOCX can name anything. */
export function fontStack(family: string): string {
  return findFont(family)?.stack ?? `'${family}', sans-serif`
}
