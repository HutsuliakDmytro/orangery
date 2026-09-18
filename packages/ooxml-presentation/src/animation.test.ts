import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findChild, getPartText } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { rewriteEveryPart, saveDeck } from './save'
import { flatten } from './shape-tree'

/**
 * Animations, which we keep and do not play.
 *
 * `p:timing` is the largest thing in a deck that nothing here models, and the
 * one most likely to be silently dropped by a serialiser that rebuilds what it
 * understands. So it is checked the hard way: every part is forced through
 * parse and serialise, and the bytes have to come back the same.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

describe('the timing of a slide', () => {
  it('is there to begin with', async () => {
    const pkg = await load('animations')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(findChild(slide.root, 'p:timing')).toBeDefined()
  })

  it('survives a save with nothing edited', async () => {
    const original = await load('animations')
    const reopened = await readPptxPackage(await saveDeck(original))

    expect(reopened.parts.get('ppt/slides/slide1.xml')?.bytes).toStrictEqual(
      original.parts.get('ppt/slides/slide1.xml')?.bytes,
    )
  })

  it('survives every part being regenerated, which is the harsher question', async () => {
    const original = await load('animations')

    const rewritten = await load('animations')
    rewriteEveryPart(rewritten, readDeck(rewritten))
    const reopened = await readPptxPackage(await saveDeck(rewritten))

    const before = getPartText(original, 'ppt/slides/slide1.xml') ?? ''
    const after = getPartText(reopened, 'ppt/slides/slide1.xml') ?? ''

    // Not byte equality — regenerating normalises whitespace — but nothing of
    // the timing may go missing.
    for (const marker of [
      'p:timing',
      'nodeType="mainSeq"',
      'presetClass="entr"',
      'filter="fade"',
      'style.visibility',
      '<p:sldTgt/>',
    ]) {
      expect(after, marker).toContain(marker)
    }
    expect(before).toContain('p:timing')
  })

  it('keeps every element of it, not merely the outer one', async () => {
    const pkg = await load('animations')
    const before = (getPartText(pkg, 'ppt/slides/slide1.xml') ?? '').match(/<p:cTn /gu)?.length ?? 0

    rewriteEveryPart(pkg, readDeck(pkg))
    const after = (getPartText(pkg, 'ppt/slides/slide1.xml') ?? '').match(/<p:cTn /gu)?.length ?? 0

    expect(before).toBeGreaterThan(4)
    expect(after).toBe(before)
  })
})

describe('a shape the file hides', () => {
  it('is read as hidden', async () => {
    const pkg = await load('animations')
    const slide = readDeck(pkg).slides[1]
    if (slide === undefined) throw new Error('fixture changed')

    const hidden = flatten(slide.shapes).filter((shape) => shape.hidden)
    expect(hidden.map((shape) => shape.name)).toEqual(['Oval 3'])
  })

  it('is not hidden just because the deck has animations', async () => {
    // Nothing to do with animation: a hidden shape is hidden before the show
    // starts and after it ends.
    const pkg = await load('animations')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(flatten(slide.shapes).every((shape) => !shape.hidden)).toBe(true)
  })

  it('stays in the file', async () => {
    const pkg = await readPptxPackage(await saveDeck(await load('animations')))
    expect(getPartText(pkg, 'ppt/slides/slide2.xml') ?? '').toContain('hidden="1"')
  })
})
