/**
 * Font list.
 *
 * Bundled families are listed first: their files ship with the app
 * (`@orangery/fonts`), so they are the only ones guaranteed to render
 * identically on every OS (CLAUDE.md "Known hard problems"). System families
 * follow: they are what users expect in a Word-compatible picker, and a DOCX
 * that names one must keep naming it even where it is unavailable.
 *
 * What a system family falls back to is not a matter of taste. A substitute
 * with different advance widths moves every line break in the document, so each
 * stack names the bundled family that is metric-compatible with it — Carlito
 * for Calibri, Caladea for Cambria, Liberation Sans for Arial — and a
 * good-looking font with the wrong metrics is the wrong answer.
 */

export interface FontOption {
  /** The family name as it is written into the document — never localised. */
  family: string
  label: string
  /** CSS stack used for rendering only. */
  stack: string
  bundled: boolean
  /**
   * The bundled family with the same advance widths, or null when none ships.
   *
   * Written down rather than left implicit in the stack: null is a statement —
   * a document in this family will reflow on a machine that lacks it, and there
   * is nothing we can currently do about that.
   */
  substitute: string | null
}

export const BUNDLED_FONTS: readonly FontOption[] = [
  {
    family: 'Inter',
    label: 'Inter',
    stack: 'Inter, system-ui, sans-serif',
    bundled: true,
    substitute: null,
  },
  {
    family: 'Liberation Serif',
    label: 'Liberation Serif',
    stack: "'Liberation Serif', serif",
    bundled: true,
    substitute: null,
  },
  {
    family: 'Liberation Sans',
    label: 'Liberation Sans',
    stack: "'Liberation Sans', sans-serif",
    bundled: true,
    substitute: null,
  },
  {
    family: 'Liberation Mono',
    label: 'Liberation Mono',
    stack: "'Liberation Mono', monospace",
    bundled: true,
    substitute: null,
  },
]

/**
 * Families Word offers by default.
 *
 * Each names the bundled family with the same metrics after itself, so a
 * document keeps its line breaks on a machine that has never had Office
 * installed. Georgia and Verdana have no metric-compatible free substitute, so
 * they say so rather than falling back to something that merely looks similar.
 */
export const SYSTEM_FONTS: readonly FontOption[] = [
  {
    family: 'Arial',
    label: 'Arial',
    stack: "Arial, Helvetica, 'Liberation Sans', sans-serif",
    bundled: false,
    substitute: 'Liberation Sans',
  },
  {
    family: 'Times New Roman',
    label: 'Times New Roman',
    stack: "'Times New Roman', Times, 'Liberation Serif', serif",
    bundled: false,
    substitute: 'Liberation Serif',
  },
  {
    family: 'Calibri',
    label: 'Calibri',
    stack: 'Calibri, Carlito, sans-serif',
    bundled: false,
    substitute: 'Carlito',
  },
  {
    family: 'Cambria',
    label: 'Cambria',
    stack: 'Cambria, Caladea, serif',
    bundled: false,
    substitute: 'Caladea',
  },
  {
    family: 'Georgia',
    label: 'Georgia',
    stack: 'Georgia, serif',
    bundled: false,
    substitute: null,
  },
  {
    family: 'Verdana',
    label: 'Verdana',
    stack: 'Verdana, Geneva, sans-serif',
    bundled: false,
    substitute: null,
  },
  {
    family: 'Courier New',
    label: 'Courier New',
    stack: "'Courier New', Courier, 'Liberation Mono', monospace",
    bundled: false,
    substitute: 'Liberation Mono',
  },
  {
    // Helvetica and Arial share their metrics, so the same substitute serves.
    family: 'Helvetica',
    label: 'Helvetica',
    stack: "Helvetica, Arial, 'Liberation Sans', sans-serif",
    bundled: false,
    substitute: 'Liberation Sans',
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
