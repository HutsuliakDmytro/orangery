import { buildXml, getPartText, setPartText, writePackage } from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import type { Deck, SlidePart } from './deck'

/**
 * Writing a deck back.
 *
 * Only parts that were edited are regenerated; everything else goes back from
 * the buffers it was read into, which is what the whole package layer exists
 * for. Within an edited part, the shape's own subtree is patched rather than
 * rebuilt — see `apps/slides/docs/adr/0002-pptx-roundtrip.md`.
 */

/**
 * The XML declaration the part was written with, or none.
 *
 * Not normalised to ours. PowerPoint writes double quotes and a CRLF,
 * python-pptx writes single quotes and a newline, and a part we did not
 * otherwise change must come back exactly as it was — including the twenty-odd
 * bytes nobody looks at.
 */
export function declarationOf(text: string): string {
  return /^\s*<\?xml[^?]*\?>\r?\n?/u.exec(text)?.[0] ?? ''
}

/** Serialises a parsed root back into its part, keeping the original preamble. */
export function writePart(pkg: OoxmlPackage, path: string, root: XmlNode): void {
  const declaration = declarationOf(getPartText(pkg, path) ?? '')
  setPartText(pkg, path, `${declaration}${buildXml([root])}`)
}

/** Writes a slide, layout or master back from the node it was parsed from. */
export function writeSlidePart(pkg: OoxmlPackage, part: SlidePart): void {
  writePart(pkg, part.path, part.root)
}

/**
 * Regenerates every part of the deck that holds a shape tree.
 *
 * Used by the round-trip test rather than by saving: an ordinary save touches
 * only what was edited. Forcing every part through parse and back is how we
 * find out whether the two are actually inverse, which is the property the
 * preservation guarantee rests on.
 */
export function rewriteEveryPart(pkg: OoxmlPackage, deck: Deck): void {
  for (const part of [...deck.masters.values(), ...deck.layouts.values(), ...deck.slides]) {
    writeSlidePart(pkg, part)
  }
}

export function saveDeck(pkg: OoxmlPackage): Promise<Uint8Array> {
  return writePackage(pkg)
}
