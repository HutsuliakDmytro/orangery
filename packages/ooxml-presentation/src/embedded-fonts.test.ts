import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addRelationship,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { readEmbeddedFonts } from './embedded-fonts'
import {
  CONVENTIONAL_PRESENTATION_PART,
  CONVENTIONAL_PRESENTATION_RELS_PART,
  readPptxPackage,
} from './parts'

/**
 * The fonts a deck carries with it.
 *
 * No fixture embeds one — python-pptx will not make such a deck — so the parts
 * are added here. What is being read is a list and four relationships, and a
 * package built to say exactly that is clearer than one that says it by
 * accident.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** Adds an embedded font list naming the given faces, with their parts. */
async function withFonts(list: string, parts: readonly string[] = []): Promise<OoxmlPackage> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))

  const relationships = parseRelationships(
    getPartText(pkg, CONVENTIONAL_PRESENTATION_RELS_PART) ?? '',
  )
  for (const [index, part] of parts.entries()) {
    // The ids have to be the ones the list names, so they are made in order.
    addRelationship(
      relationships,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font',
      `fonts/${part}`,
    )
    pkg.parts.set(`ppt/fonts/${part}`, {
      path: `ppt/fonts/${part}`,
      bytes: new Uint8Array([0, 1, 0, 0, index]),
      date: new Date(0),
    })
  }
  setPartText(pkg, CONVENTIONAL_PRESENTATION_RELS_PART, serializeRelationships(relationships))

  const text = getPartText(pkg, CONVENTIONAL_PRESENTATION_PART) ?? ''
  setPartText(pkg, CONVENTIONAL_PRESENTATION_PART, text.replace('<p:sldSz', `${list}<p:sldSz`))
  return pkg
}

/** The relationship ids the fixture's own parts already use, plus ours. */
const idsFrom = async () => {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
  return parseRelationships(getPartText(pkg, CONVENTIONAL_PRESENTATION_RELS_PART) ?? '').size
}

describe('a deck that carries its own fonts', () => {
  it('reads the typeface and every weight it names', async () => {
    const next = await idsFrom()
    const pkg = await withFonts(
      '<p:embeddedFontLst><p:embeddedFont><p:font typeface="Brandon Text"/>' +
        `<p:regular r:id="rId${String(next + 1)}"/><p:bold r:id="rId${String(next + 2)}"/>` +
        '</p:embeddedFont></p:embeddedFontLst>',
      ['font1.fntdata', 'font2.fntdata'],
    )

    const fonts = readEmbeddedFonts(pkg)
    expect(fonts).toHaveLength(1)
    expect(fonts[0]?.typeface).toBe('Brandon Text')
    expect(fonts[0]?.faces.map((face) => face.style)).toEqual(['regular', 'bold'])
    expect(fonts[0]?.faces[0]?.path).toBe('ppt/fonts/font1.fntdata')
  })

  it('drops a face whose part is not in the package', async () => {
    const pkg = await withFonts(
      '<p:embeddedFontLst><p:embeddedFont><p:font typeface="Ghost"/>' +
        '<p:regular r:id="rIdNothing"/></p:embeddedFont></p:embeddedFontLst>',
    )

    // A path nothing can read is worse than no path: something would try it.
    expect(readEmbeddedFonts(pkg)).toEqual([])
  })

  it('reads nothing from a deck that embeds nothing', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    expect(readEmbeddedFonts(pkg)).toEqual([])
  })
})
