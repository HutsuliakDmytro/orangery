import type { SectionProperties } from '../ooxml/section'

/**
 * Printing and PDF export.
 *
 * Both go through the webview's print pipeline: Tauri's window has no separate
 * PDF renderer, and using one would mean a second layout engine that disagrees
 * with what the user sees. The page geometry is handed over as an `@page` rule,
 * because CSS cannot read it from the element.
 */

export const PAGE_STYLE_ID = 'orangery-page-rule'

/**
 * Builds the `@page` rule for a section. Sizes are in points, which is what
 * OOXML stores and what print CSS accepts directly.
 */
export function pageRule(section: SectionProperties): string {
  const { margins } = section

  return `@page {
  size: ${String(section.width)}pt ${String(section.height)}pt;
  margin: ${String(margins.top)}pt ${String(margins.right)}pt ${String(margins.bottom)}pt ${String(margins.left + margins.gutter)}pt;
}`
}

/**
 * Installs the rule before printing.
 *
 * `@page` cannot be set from an inline style, and the values change with the
 * document, so the rule is written into a stylesheet the app owns and replaces.
 */
export function applyPageRule(section: SectionProperties): void {
  if (typeof document === 'undefined') return

  let style = document.getElementById(PAGE_STYLE_ID)
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement('style')
    style.id = PAGE_STYLE_ID
    document.head.append(style)
  }

  style.textContent = pageRule(section)
}

/**
 * Opens the system print dialog.
 *
 * The browser's own `print()` is what the webview exposes; on macOS it presents
 * the standard sheet, which includes "Save as PDF". That is the PDF export path
 * too — a separate renderer would produce output that differs from the preview.
 */
export function printDocument(section: SectionProperties): void {
  applyPageRule(section)
  if (typeof window !== 'undefined') window.print()
}
