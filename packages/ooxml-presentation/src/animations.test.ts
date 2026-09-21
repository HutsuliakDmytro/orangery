import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml } from '@orangery/ooxml-core'
import { hiddenUntilAnimated, readAnimations } from './animations'
import { readDeck } from './deck'
import type { SlidePart } from './deck'
import { readPptxPackage } from './parts'

/**
 * Reading what a slide plays.
 *
 * The markup is deeper than what it describes — a single fade is six nested
 * `p:par` nodes — so the tests are written as the effects a person would
 * describe, not as the tree they are written in.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function slideOf(name: string, index = 0): Promise<SlidePart> {
  const deck = readDeck(await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`))))
  const slide = deck.slides[index]
  if (slide === undefined) throw new Error('fixture has no such slide')
  return slide
}

/** A slide part holding the given timing and nothing else. */
function timedBy(timing: string): SlidePart {
  const root = parseXml(`<p:sld xmlns:p="p">${timing}</p:sld>`)[0]
  if (root === undefined) throw new Error('bad fixture')
  return { path: 'ppt/slides/slide1.xml', root, tree: root, shapes: [] }
}

/** The nesting PowerPoint writes around every main sequence. */
const sequence = (steps: string) =>
  '<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq>' +
  `<p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${steps}` +
  '</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

/** One click step holding the effects given. */
const step = (effects: string) =>
  '<p:par><p:cTn id="3"><p:childTnLst><p:par><p:cTn id="4"><p:childTnLst>' +
  effects +
  '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'

const effect = ({
  id = 5,
  spid = 3,
  cls = 'entr',
  node = 'clickEffect',
  preset = 10,
  subtype = 0,
  dur = 500,
  delay = 0,
  filter = 'fade',
}: Partial<{
  id: number
  spid: number
  cls: string
  node: string
  preset: number
  subtype: number
  dur: number
  delay: number
  filter: string
}>) =>
  `<p:par><p:cTn id="${String(id)}" presetID="${String(preset)}" presetClass="${cls}" ` +
  `presetSubtype="${String(subtype)}" nodeType="${node}">` +
  `<p:stCondLst><p:cond delay="${String(delay)}"/></p:stCondLst><p:childTnLst>` +
  `<p:set><p:cBhvr><p:cTn id="${String(id + 1)}" dur="1"/>` +
  `<p:tgtEl><p:spTgt spid="${String(spid)}"/></p:tgtEl></p:cBhvr></p:set>` +
  `<p:animEffect transition="in" filter="${filter}"><p:cBhvr>` +
  `<p:cTn id="${String(id + 2)}" dur="${String(dur)}"/>` +
  `<p:tgtEl><p:spTgt spid="${String(spid)}"/></p:tgtEl></p:cBhvr></p:animEffect>` +
  '</p:childTnLst></p:cTn></p:par>'

describe('a slide from the corpus', () => {
  it('reads its one entrance', async () => {
    const steps = readAnimations(await slideOf('animations'))

    expect(steps).toHaveLength(1)
    expect(steps[0]?.effects[0]).toMatchObject({ kind: 'entrance', filter: 'fade', preset: 10 })
  })

  it('finds the shape the effect is aimed at', async () => {
    const steps = readAnimations(await slideOf('animations'))
    expect(steps[0]?.effects[0]?.shapeId).toBeGreaterThan(0)
  })

  it('reads nothing from a slide with no timing', async () => {
    expect(readAnimations(await slideOf('animations', 1))).toEqual([])
  })
})

describe('what counts as one press', () => {
  it('starts a step at every effect that waits for a click', () => {
    const slide = timedBy(sequence(step(effect({ id: 5 })) + step(effect({ id: 15, spid: 4 }))))
    expect(readAnimations(slide)).toHaveLength(2)
  })

  it('keeps the ones that run with the previous in the same step', () => {
    const slide = timedBy(
      sequence(step(effect({ id: 5 }) + effect({ id: 15, spid: 4, node: 'withEffect' }))),
    )

    const steps = readAnimations(slide)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.effects).toHaveLength(2)
  })

  it('keeps the ones that follow the previous in it too', () => {
    // "After previous" is still one press: nobody clicks for it.
    const slide = timedBy(
      sequence(step(effect({ id: 5 }) + effect({ id: 15, spid: 4, node: 'afterEffect' }))),
    )

    expect(readAnimations(slide)[0]?.effects.map((one) => one.trigger)).toEqual(['click', 'after'])
  })

  it('opens a step for an effect that has nothing to go with', () => {
    const slide = timedBy(sequence(step(effect({ node: 'withEffect' }))))
    expect(readAnimations(slide)).toHaveLength(1)
  })
})

describe('how long an effect takes', () => {
  it('takes the length from the behaviour, not from the effect node', () => {
    // The effect's own `p:cTn` says nothing; the `p:set` beside the real work
    // flips visibility for a millisecond, and that is not the length.
    const slide = timedBy(sequence(step(effect({ dur: 750 }))))
    expect(readAnimations(slide)[0]?.effects[0]?.duration).toBe(750)
  })

  it('reads the delay a step waits before starting', () => {
    const slide = timedBy(sequence(step(effect({ delay: 250 }))))
    expect(readAnimations(slide)[0]?.effects[0]?.delay).toBe(250)
  })

  it('reads an indefinite delay as none rather than as a number', () => {
    const slide = timedBy(
      sequence(
        '<p:par><p:cTn id="3"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>' +
          `<p:childTnLst><p:par><p:cTn id="4"><p:childTnLst>${effect({})}` +
          '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>',
      ),
    )

    expect(readAnimations(slide)[0]?.effects[0]?.delay).toBe(0)
  })
})

describe('what is on the slide before anything is pressed', () => {
  it('holds back a shape that has an entrance', () => {
    const slide = timedBy(sequence(step(effect({ spid: 7 }))))
    expect([...hiddenUntilAnimated(readAnimations(slide))]).toEqual([7])
  })

  it('leaves a shape that only leaves or is emphasised', () => {
    // A shape that is emphasised and then made to leave was on the slide from
    // the start; hiding it would be showing an empty slide.
    const slide = timedBy(
      sequence(
        step(effect({ spid: 7, cls: 'emph' })) + step(effect({ id: 15, spid: 7, cls: 'exit' })),
      ),
    )

    expect(hiddenUntilAnimated(readAnimations(slide)).size).toBe(0)
  })

  it('holds back nothing on a slide that plays nothing', () => {
    expect(hiddenUntilAnimated([]).size).toBe(0)
  })
})
