import { readEmbeddedFonts } from '@orangery/ooxml-presentation'
import type { EmbeddedFont, FontStyle } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Giving the engine the fonts a deck brought with it.
 *
 * Registered under the typeface's own name, which is all the renderer needs:
 * the stack it builds already asks for that name first and has only ever found
 * nothing there. The substitutes behind it stay where they are and go on doing
 * their job for the decks that carry no fonts.
 *
 * The bytes are handed over as they are and the engine decides. PowerPoint
 * writes these parts with a `.fntdata` extension and no promise about what is
 * inside; a browser that cannot make a face out of them says so, and the deck
 * falls back to the substitution it would have had anyway. Guessing at a
 * wrapper to strip would be inventing a format.
 */

/** What each face is, as CSS describes a font rather than as the file does. */
const DESCRIPTORS: Readonly<Record<FontStyle, { weight: string; style: string }>> = {
  regular: { weight: '400', style: 'normal' },
  bold: { weight: '700', style: 'normal' },
  italic: { weight: '400', style: 'italic' },
  boldItalic: { weight: '700', style: 'italic' },
}

export interface LoadedFonts {
  /** The typefaces the engine accepted, which is what will actually be drawn. */
  loaded: string[]
  /** The ones it refused, which the banner says out loud. */
  refused: string[]
  /** Takes them all back out again, for when the deck is closed. */
  release: () => void
}

const NOTHING: LoadedFonts = { loaded: [], refused: [], release: () => undefined }

/** Registers every weight of one typeface. Answers whether any of them took. */
async function addFaces(
  pkg: OoxmlPackage,
  font: EmbeddedFont,
  faces: Set<FontFace>,
): Promise<boolean> {
  let any = false

  for (const face of font.faces) {
    const bytes = pkg.parts.get(face.path)?.bytes
    if (bytes === undefined) continue

    try {
      // Copied out of the package's buffer: `FontFace` wants a plain
      // `ArrayBuffer`, and the part's view may sit inside a shared one.
      const loaded = new FontFace(font.typeface, bytes.slice().buffer, DESCRIPTORS[face.style])
      await loaded.load()
      document.fonts.add(loaded)
      faces.add(loaded)
      any = true
    } catch {
      // Not a font this engine can read. One weight failing is not the whole
      // typeface failing, so the others are still tried.
    }
  }

  return any
}

/**
 * Loads every font a package embeds. Returns what was loaded and what was not.
 *
 * Asynchronous because a face has to be parsed before it can be used, and a
 * deck drawn with half its fonts registered would redraw as each one arrived.
 */
export async function loadEmbeddedFonts(pkg: OoxmlPackage): Promise<LoadedFonts> {
  if (typeof FontFace === 'undefined') return NOTHING

  const fonts = readEmbeddedFonts(pkg)
  if (fonts.length === 0) return NOTHING

  const faces = new Set<FontFace>()
  const loaded: string[] = []
  const refused: string[] = []

  for (const font of fonts) {
    const taken = await addFaces(pkg, font, faces)
    ;(taken ? loaded : refused).push(font.typeface)
  }

  return {
    loaded,
    refused,
    release: () => {
      // A second deck with the same typeface at different weights would
      // otherwise be drawn in the first one's.
      for (const face of faces) document.fonts.delete(face)
      faces.clear()
    },
  }
}
