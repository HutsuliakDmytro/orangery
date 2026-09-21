import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { addNarration } from './narration'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten } from './shape-tree'

/**
 * The sound of somebody talking over a slide.
 *
 * Read back through the app's own media reader after a save and a reopen: a
 * recording written in a shape this app cannot read would be a recording this
 * app just lost.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const recording = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  fileName: 'narration.m4a',
  contentType: 'audio/mp4',
}

/** Puts a recording on the first slide, saves, and reopens. */
async function recorded(): Promise<{ pkg: OoxmlPackage; id: number | null }> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  const id = addNarration(pkg, slide, recording)
  writeSlidePart(pkg, slide)

  return { pkg: await readPptxPackage(await saveDeck(pkg)), id }
}

describe('a recording on a slide', () => {
  it('comes back as a sound this app can find', async () => {
    const { pkg, id } = await recorded()
    const slide = readDeck(pkg).slides[0]
    const shape = flatten(slide?.shapes ?? []).find((one) => one.id === id)

    expect(shape?.media).not.toBeNull()
    expect(shape?.media?.kind).toBe('audio')
  })

  it('carries both the relationships PowerPoint writes', async () => {
    const { pkg } = await recorded()
    const rels = parseRelationships(getPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels') ?? '')
    const types = [...rels.values()].map((one) => one.type)

    // The older reference and the newer embed, pointing at the same bytes: a
    // file with only one of them opens in something, but not in everything.
    expect(types.some((type) => type.endsWith('/audio'))).toBe(true)
    expect(types.some((type) => type.endsWith('/media'))).toBe(true)
  })

  it('puts the bytes in the package once', async () => {
    const { pkg } = await recorded()
    const media = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/media/'))

    expect(media).toHaveLength(1)
    expect(pkg.parts.get(media[0] ?? '')?.bytes).toHaveLength(4)
  })

  it('declares what kind of file it is', async () => {
    const { pkg } = await recorded()
    expect(getPartText(pkg, '[Content_Types].xml')).toContain('audio/mp4')
  })

  it('refuses a recording with nothing in it', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    expect(addNarration(pkg, slide, { ...recording, bytes: new Uint8Array() })).toBeNull()
  })

  it('gives each slide its own, without their ids colliding', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    const first = addNarration(pkg, slide, recording)
    const second = addNarration(pkg, slide, recording)

    expect(first).not.toBe(second)
  })
})
