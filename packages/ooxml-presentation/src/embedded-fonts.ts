import {
  attribute,
  children,
  findChild,
  getPartText,
  parseRelationships,
  parseXml,
  resolveTarget,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { PRESENTATION_PART, PRESENTATION_RELS_PART } from './parts'

/**
 * The fonts a deck carries with it.
 *
 * `p:embeddedFontLst` names a typeface and points at a part per weight. The
 * point of them is a deck that reads the same on a machine that has never heard
 * of the font it was made with — which is the whole reason somebody ticks the
 * box, and the reason a substitution is a poor second: the line breaks move.
 *
 * Read only, like everything else about the package here. The parts are
 * preserved whole; whether an engine can make a usable face out of the bytes is
 * the renderer's question, and it is allowed to answer no.
 */

/** The four faces `p:embeddedFont` can name, in the order it lists them. */
export type FontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic'

const STYLES: Readonly<Record<string, FontStyle>> = {
  'p:regular': 'regular',
  'p:bold': 'bold',
  'p:italic': 'italic',
  'p:boldItalic': 'boldItalic',
}

export interface EmbeddedFace {
  style: FontStyle
  /** Path in the package, usually `ppt/fonts/fontN.fntdata`. */
  path: string
}

export interface EmbeddedFont {
  /** The name a shape asks for it by, exactly as the shape spells it. */
  typeface: string
  faces: EmbeddedFace[]
}

export function readEmbeddedFonts(pkg: OoxmlPackage): EmbeddedFont[] {
  const root = parseXml(getPartText(pkg, PRESENTATION_PART) ?? '').find(
    (node) => tagName(node) === 'p:presentation',
  )
  const list = root === undefined ? undefined : findChild(root, 'p:embeddedFontLst')
  if (list === undefined) return []

  const relationships = parseRelationships(getPartText(pkg, PRESENTATION_RELS_PART) ?? '')

  return children(list).flatMap((embedded) => {
    if (tagName(embedded) !== 'p:embeddedFont') return []

    const font = findChild(embedded, 'p:font')
    const typeface = font === undefined ? undefined : attribute(font, 'typeface')
    if (typeface === undefined || typeface === '') return []

    const faces = children(embedded).flatMap((child): EmbeddedFace[] => {
      const style = STYLES[tagName(child) ?? '']
      const id = attribute(child, 'r:id')
      const target = id === undefined ? undefined : relationships.get(id)?.target
      if (style === undefined || target === undefined) return []

      const path = resolveTarget(target, 'ppt')
      // A relationship naming a part that is not in the package is a deck that
      // was taken apart by something; the face is dropped rather than carried
      // as a path nothing can read.
      return pkg.parts.has(path) ? [{ style, path }] : []
    })

    return faces.length === 0 ? [] : [{ typeface, faces }]
  })
}
