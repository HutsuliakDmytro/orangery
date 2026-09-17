import { attribute, children, parseXml, tagName } from '@orangery/ooxml-core'

/**
 * The font table, which is WordprocessingML's own.
 *
 * Everything else that was here — the theme's two typefaces and the
 * metric-compatible substitutes — is DrawingML and lives in
 * `@orangery/ooxml-drawingml`, where a deck reads the same part.
 */

/** Families named in `word/fontTable.xml`, which lists every font the file uses. */
export function parseFontTable(xml: string): string[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'w:fonts')
  if (!root) return []

  const families: string[] = []
  for (const node of children(root)) {
    if (tagName(node) !== 'w:font') continue
    const name = attribute(node, 'w:name')
    if (name !== undefined && name !== '') families.push(name)
  }
  return families
}
