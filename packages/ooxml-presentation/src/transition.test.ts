import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseXml } from '@orangery/ooxml-core'
import { readDeck, readSlidePart } from './deck'
import type { SlidePart } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'
import { readTransition, setAdvanceTime } from './transition'

/** How one slide gives way to the next. */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** The transitions of the fixture, slide by slide. */
async function transitions() {
  const pkg = await load('transitions')
  return readDeck(pkg).slides.map((slide) => readTransition(slide))
}

describe('reading a transition', () => {
  it('reads the four we can draw', async () => {
    const [fade, push, wipe] = await transitions()

    expect(fade?.kind).toBe('fade')
    expect(push?.kind).toBe('push')
    expect(wipe?.kind).toBe('wipe')
  })

  it('reads which way a push or a wipe travels', async () => {
    const [, push, wipe] = await transitions()

    expect(push?.direction).toBe('u')
    expect(wipe?.direction).toBe('r')
  })

  it('leaves a direction off a kind that does not travel', async () => {
    const [fade] = await transitions()
    expect(fade?.direction).toBeNull()
  })

  it('turns what it cannot draw into a fade, keeping what the file said', async () => {
    // A dissolve is not "no transition": something was meant to happen.
    const [, , , dissolve] = await transitions()

    expect(dissolve?.kind).toBe('fade')
    expect(dissolve?.stated).toBe('dissolve')
  })

  it('takes the milliseconds over the speed word when both are there', async () => {
    const [, , , , timed] = await transitions()

    // `spd="slow"` would be a second, and `p14:dur` says a second and a half.
    expect(timed?.duration).toBe(1500)
  })

  it('reads a transition wrapped for compatibility', async () => {
    const [, , , , timed] = await transitions()
    expect(timed?.kind).toBe('fade')
  })

  it('turns the three speed words into the milliseconds PowerPoint uses', async () => {
    const [fade, push, wipe] = await transitions()

    expect(fade?.duration).toBe(1000)
    expect(push?.duration).toBe(750)
    expect(wipe?.duration).toBe(500)
  })

  it('finds none on a slide that states none', async () => {
    const pkg = await load('many-slides')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(readTransition(slide)).toBeNull()
  })
})

describe('what the file keeps', () => {
  it('writes the slides back byte for byte', async () => {
    // We read a transition and never write one, so a deck that had a
    // checkerboard still has a checkerboard.
    const original = await load('transitions')
    const reopened = await readPptxPackage(await saveDeck(original))

    for (const [path, part] of original.parts) {
      expect(reopened.parts.get(path)?.bytes, path).toStrictEqual(part.bytes)
    }
  })

  it('keeps the compatibility wrapper as it was', async () => {
    const pkg = await readPptxPackage(await saveDeck(await load('transitions')))
    const text = getPartText(pkg, 'ppt/slides/slide5.xml') ?? ''

    expect(text).toContain('mc:AlternateContent')
    expect(text).toContain('mc:Fallback')
    expect(text).toContain('p14:dur="1500"')
  })

  it('reads one out of a part read on its own, not only out of a deck', async () => {
    const pkg = await load('transitions')
    const part = readSlidePart(pkg, 'ppt/slides/slide2.xml')
    if (part === null) throw new Error('lost the slide')

    expect(readTransition(part)?.kind).toBe('push')
  })
})

describe('a transition that carries only a timing', () => {
  const slideWith = (xml: string): SlidePart => {
    const root = parseXml(`<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld>${xml}</p:sld>`)[0]
    if (root === undefined) throw new Error('bad fixture')
    return { path: 'ppt/slides/slide1.xml', root, tree: root, shapes: [] }
  }

  it('states no effect rather than a fade', () => {
    // What rehearsing leaves behind. Fading it would invent a transition the
    // file never asked for.
    const slide = slideWith('<p:transition advTm="4000"/>')

    expect(readTransition(slide)?.kind).toBe('none')
    expect(readTransition(slide)?.advanceAfter).toBe(4000)
  })

  it('reads the timing beside a real transition too', () => {
    const slide = slideWith('<p:transition advTm="2500"><p:fade/></p:transition>')

    expect(readTransition(slide)?.kind).toBe('fade')
    expect(readTransition(slide)?.advanceAfter).toBe(2500)
  })

  it('says nothing about advancing where the slide waits for a press', () => {
    expect(readTransition(slideWith('<p:transition><p:fade/></p:transition>'))?.advanceAfter).toBe(
      null,
    )
  })
})

describe('writing down how long a slide was up', () => {
  const bare = (): SlidePart => {
    const root = parseXml('<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>')[0]
    if (root === undefined) throw new Error('bad fixture')
    return { path: 'ppt/slides/slide1.xml', root, tree: root, shapes: [] }
  }

  it('gives a slide that had no transition a timing and nothing else', () => {
    const slide = bare()
    expect(setAdvanceTime(slide, 3000)).toBe(true)

    // A deck that started dissolving because it was practised would be a deck
    // changed by being practised.
    expect(readTransition(slide)).toMatchObject({ kind: 'none', advanceAfter: 3000 })
  })

  it('leaves a transition that was already there alone', () => {
    const root = parseXml(
      '<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld><p:transition><p:push dir="l"/></p:transition></p:sld>',
    )[0]
    if (root === undefined) throw new Error('bad fixture')
    const slide: SlidePart = { path: 'ppt/slides/slide1.xml', root, tree: root, shapes: [] }

    setAdvanceTime(slide, 1500)
    expect(readTransition(slide)).toMatchObject({
      kind: 'push',
      direction: 'l',
      advanceAfter: 1500,
    })
  })

  it('takes the timing off, and the element with it when that was all', () => {
    const slide = bare()
    setAdvanceTime(slide, 3000)
    expect(setAdvanceTime(slide, null)).toBe(true)

    expect(readTransition(slide)).toBeNull()
  })

  it('says nothing changed when it is already that', () => {
    const slide = bare()
    setAdvanceTime(slide, 3000)
    expect(setAdvanceTime(slide, 3000)).toBe(false)
  })
})
