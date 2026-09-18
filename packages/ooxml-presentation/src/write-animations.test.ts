import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml, serializeNode } from '@orangery/ooxml-core'
import { readAnimations } from './animations'
import { readDeck } from './deck'
import type { SlidePart } from './deck'
import { readPptxPackage } from './parts'
import { addEffect, moveStep, removeEffect, setEffectTiming } from './write-animations'

/**
 * Changing what a slide plays.
 *
 * Every test reads the timing back through the reader rather than matching the
 * XML: what matters is that the effect is there and means what was asked for,
 * and the nesting it takes to say that is the writer's business.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function slideOf(name: string, index = 0): Promise<SlidePart> {
  const deck = readDeck(await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`))))
  const slide = deck.slides[index]
  if (slide === undefined) throw new Error('fixture has no such slide')
  return slide
}

/** A slide with nothing on it and no timing at all. */
function bare(): SlidePart {
  const root = parseXml('<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>')[0]
  if (root === undefined) throw new Error('bad fixture')
  return { path: 'ppt/slides/slide1.xml', root, tree: root, shapes: [] }
}

const entrance = (shapeId: number, over = {}) =>
  ({ shapeId, name: 'fade', kind: 'entrance', trigger: 'click', ...over }) as const

describe('adding an effect', () => {
  it('gives a slide that plays nothing something to play', () => {
    const slide = bare()
    expect(addEffect(slide, entrance(5))).toBe(true)

    const steps = readAnimations(slide)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.effects[0]).toMatchObject({ shapeId: 5, kind: 'entrance', filter: 'fade' })
  })

  it('puts the timing where a slide keeps it', () => {
    const slide = bare()
    addEffect(slide, entrance(5))

    const written = serializeNode(slide.root)
    expect(written.indexOf('p:cSld')).toBeLessThan(written.indexOf('p:timing'))
  })

  it('adds a step to a slide that already plays something', async () => {
    const slide = await slideOf('animations')
    const before = readAnimations(slide).length

    addEffect(slide, entrance(4))
    expect(readAnimations(slide)).toHaveLength(before + 1)
  })

  it('joins the step already open when it runs with the previous', () => {
    const slide = bare()
    addEffect(slide, entrance(5))
    addEffect(slide, entrance(6, { trigger: 'with' }))

    const steps = readAnimations(slide)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.effects.map((one) => one.shapeId)).toEqual([5, 6])
  })

  it('makes a step of its own for one that has nothing to join', () => {
    const slide = bare()
    expect(addEffect(slide, entrance(5, { trigger: 'after' }))).toBe(true)
    expect(readAnimations(slide)).toHaveLength(1)
  })

  it('never gives two effects the same name', () => {
    const slide = bare()
    addEffect(slide, entrance(5))
    addEffect(slide, entrance(6))

    const ids = readAnimations(slide).flatMap((step) => step.effects.map((one) => one.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('writes the length and the wait it was given', () => {
    const slide = bare()
    addEffect(slide, entrance(5, { duration: 1200, delay: 400 }))

    const effect = readAnimations(slide)[0]?.effects[0]
    expect(effect?.duration).toBe(1200)
    expect(effect?.delay).toBe(400)
  })

  it('writes an exit as an exit', () => {
    const slide = bare()
    addEffect(slide, { shapeId: 5, name: 'fade', kind: 'exit', trigger: 'click' })

    expect(readAnimations(slide)[0]?.effects[0]?.kind).toBe('exit')
  })

  it('refuses an effect it cannot write exactly', () => {
    // Reading a fly-in works; offering to make one we would get wrong does not.
    const slide = bare()
    expect(
      addEffect(slide, { shapeId: 5, name: 'pulse', kind: 'entrance', trigger: 'click' }),
    ).toBe(false)
    expect(readAnimations(slide)).toEqual([])
  })
})

describe('taking an effect out', () => {
  it('removes the one named and leaves the rest', () => {
    const slide = bare()
    addEffect(slide, entrance(5))
    addEffect(slide, entrance(6))

    const second = readAnimations(slide)[1]?.effects[0]
    if (second === undefined) throw new Error('nothing was added')
    expect(removeEffect(slide, second.id)).toBe(true)

    const steps = readAnimations(slide)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.effects[0]?.shapeId).toBe(5)
  })

  it('takes the step with it when nothing is left in it', () => {
    // A press that plays nothing looks like the show has frozen.
    const slide = bare()
    addEffect(slide, entrance(5))

    const only = readAnimations(slide)[0]?.effects[0]
    removeEffect(slide, only?.id ?? -1)
    expect(readAnimations(slide)).toEqual([])
  })

  it('says no to an effect that is not there', () => {
    expect(removeEffect(bare(), 99)).toBe(false)
  })
})

describe('changing an effect', () => {
  /** A slide with one fade on it, and that effect. */
  const withOne = () => {
    const slide = bare()
    addEffect(slide, entrance(5))
    const effect = readAnimations(slide)[0]?.effects[0]
    if (effect === undefined) throw new Error('nothing was added')
    return { slide, effect }
  }

  it('changes how long it takes', () => {
    const { slide, effect } = withOne()
    expect(setEffectTiming(slide, effect.id, { duration: 2000 })).toBe(true)

    expect(readAnimations(slide)[0]?.effects[0]?.duration).toBe(2000)
  })

  it('changes how long it waits', () => {
    const { slide, effect } = withOne()
    setEffectTiming(slide, effect.id, { delay: 750 })

    expect(readAnimations(slide)[0]?.effects[0]?.delay).toBe(750)
  })

  it('changes what starts it', () => {
    const { slide, effect } = withOne()
    setEffectTiming(slide, effect.id, { trigger: 'after' })

    expect(readAnimations(slide)[0]?.effects[0]?.trigger).toBe('after')
  })

  it('leaves the one-millisecond behaviour alone', () => {
    // The `p:set` that flips visibility is not the length of anything.
    const { slide, effect } = withOne()
    setEffectTiming(slide, effect.id, { duration: 2000 })

    expect(serializeNode(slide.root)).toContain('dur="1"')
  })
})

describe('the order the steps play in', () => {
  it('moves one to where it was put', () => {
    const slide = bare()
    addEffect(slide, entrance(5))
    addEffect(slide, entrance(6))
    addEffect(slide, entrance(7))

    expect(moveStep(slide, 2, 0)).toBe(true)
    const order = readAnimations(slide).map((step) => step.effects[0]?.shapeId)
    expect(order).toEqual([7, 5, 6])
  })

  it('says no to a move that means nothing', () => {
    const slide = bare()
    addEffect(slide, entrance(5))

    expect(moveStep(slide, 0, 0)).toBe(false)
    expect(moveStep(slide, 0, 4)).toBe(false)
  })
})
