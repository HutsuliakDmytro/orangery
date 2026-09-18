import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { loadEmbeddedFonts } from './embedded-fonts'

/**
 * Handing the deck's fonts to the engine.
 *
 * `FontFace` does not exist in jsdom, which is also the case this has to answer
 * for: an engine that cannot make a face out of the bytes. So one is stood in
 * for, and told to refuse.
 */

const FONT_PART = 'ppt/fonts/font1.fntdata'

/** A package that embeds one typeface in one weight. */
function packageWith(): OoxmlPackage {
  const presentation =
    '<p:presentation xmlns:p="p" xmlns:r="r"><p:embeddedFontLst><p:embeddedFont>' +
    '<p:font typeface="Brandon Text"/><p:regular r:id="rId9"/>' +
    '</p:embeddedFont></p:embeddedFontLst></p:presentation>'

  const rels =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.fntdata"/>' +
    '</Relationships>'

  const encode = (text: string) => new TextEncoder().encode(text)
  const date = new Date(0)

  return {
    parts: new Map([
      [
        'ppt/presentation.xml',
        { path: 'ppt/presentation.xml', bytes: encode(presentation), text: presentation, date },
      ],
      [
        'ppt/_rels/presentation.xml.rels',
        { path: 'ppt/_rels/presentation.xml.rels', bytes: encode(rels), text: rels, date },
      ],
      [FONT_PART, { path: FONT_PART, bytes: new Uint8Array([0, 1, 0, 0]), date }],
    ]),
  }
}

const added: unknown[] = []
let accepts = true

class StubFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: { weight: string; style: string },
  ) {}

  load(): Promise<this> {
    return accepts ? Promise.resolve(this) : Promise.reject(new Error('unreadable'))
  }
}

beforeEach(() => {
  added.length = 0
  accepts = true
  vi.stubGlobal('FontFace', StubFace)
  // The real document, with a font set it does not have: jsdom implements none,
  // and replacing the whole document would take the rest of the tests' DOM.
  vi.stubGlobal('document', {
    fonts: {
      add: (face: unknown) => added.push(face),
      delete: (face: unknown) => {
        const at = added.indexOf(face)
        if (at !== -1) added.splice(at, 1)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a deck that carries a font', () => {
  it('registers it under the name a shape asks for it by', async () => {
    const fonts = await loadEmbeddedFonts(packageWith())

    // Which is all the renderer needs: the stack it builds already asks for
    // that name first and has only ever found nothing there.
    expect(fonts.loaded).toEqual(['Brandon Text'])
    expect(added).toHaveLength(1)
    expect((added[0] as StubFace).family).toBe('Brandon Text')
    expect((added[0] as StubFace).descriptors).toEqual({ weight: '400', style: 'normal' })
  })

  it('takes it back out again when the deck is let go', async () => {
    const fonts = await loadEmbeddedFonts(packageWith())
    fonts.release()

    // A second deck asking for the same typeface would otherwise be drawn in
    // the first one's.
    expect(added).toHaveLength(0)
  })

  it('says which typeface the engine refused rather than pretending', async () => {
    accepts = false
    const fonts = await loadEmbeddedFonts(packageWith())

    // A font that did not load is a deck that breaks its lines somewhere else,
    // which is the one thing embedding was meant to prevent.
    expect(fonts.loaded).toEqual([])
    expect(fonts.refused).toEqual(['Brandon Text'])
    expect(added).toHaveLength(0)
  })

  it('does nothing at all for a deck that embeds nothing', async () => {
    const fonts = await loadEmbeddedFonts({ parts: new Map() })
    expect(fonts.loaded).toEqual([])
    expect(fonts.refused).toEqual([])
  })
})
