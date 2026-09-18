import { describe, expect, it } from 'vitest'
import type { AnimationStep, Effect } from '@orangery/ooxml-presentation'
import { animationAt, effectStyle } from './animation'

/**
 * What a slide looks like part-way through its animations.
 *
 * A slide with builds is not one picture but several, and which one is showing
 * is a number. These are the rules for turning that number into a picture.
 */

const effect = (over: Partial<Effect> = {}): Effect => ({
  shapeId: 1,
  kind: 'entrance',
  preset: null,
  subtype: null,
  trigger: 'click',
  duration: 500,
  delay: 0,
  filter: 'fade',
  ...over,
})

const steps = (...list: Effect[][]): AnimationStep[] => list.map((effects) => ({ effects }))

describe('before anything is pressed', () => {
  it('leaves off everything that has an entrance', () => {
    const at = animationAt(steps([effect({ shapeId: 7 })]), 0)

    expect([...at.hidden]).toEqual([7])
    expect(at.playing.size).toBe(0)
  })

  it('shows a slide that animates nothing exactly as it is', () => {
    const at = animationAt([], 0)
    expect(at.hidden.size).toBe(0)
  })
})

describe('after a press', () => {
  it('puts the shape on and plays its effect', () => {
    const at = animationAt(steps([effect({ shapeId: 7 })]), 1)

    expect(at.hidden.size).toBe(0)
    expect(at.playing.get(7)?.kind).toBe('entrance')
  })

  it('plays only the step that just happened', () => {
    const at = animationAt(steps([effect({ shapeId: 7 })], [effect({ shapeId: 8 })]), 2)

    // The first one has happened; a shape does not fade in twice.
    expect(at.playing.has(7)).toBe(false)
    expect(at.playing.has(8)).toBe(true)
  })

  it('takes a shape off again when its effect is an exit', () => {
    const at = animationAt(
      steps([effect({ shapeId: 7 })], [effect({ shapeId: 7, kind: 'exit' })]),
      2,
    )

    expect([...at.hidden]).toEqual([7])
  })

  it('plays every effect of a step together', () => {
    const at = animationAt(
      steps([effect({ shapeId: 7 }), effect({ shapeId: 8, trigger: 'with' })]),
      1,
    )

    expect([...at.playing.keys()]).toEqual([7, 8])
  })

  it('cannot be pressed past the end', () => {
    const at = animationAt(steps([effect({ shapeId: 7 })]), 9)
    expect(at.step).toBe(1)
  })
})

describe('what an effect looks like', () => {
  const nameOf = (one: Effect) => effectStyle(one).animationName

  it('fades what the file says fades', () => {
    expect(nameOf(effect({ filter: 'fade' }))).toBe('orangery-fade-in')
  })

  it('reverses for an exit', () => {
    expect(nameOf(effect({ kind: 'exit' }))).toBe('orangery-fade-out')
  })

  it('flies in from the side the subtype names', () => {
    expect(nameOf(effect({ preset: 2, subtype: 2 }))).toBe('orangery-fly-from-right')
    expect(nameOf(effect({ preset: 2, subtype: 1 }))).toBe('orangery-fly-from-top')
  })

  it('wipes and zooms where the filter says so', () => {
    expect(nameOf(effect({ filter: 'wipe(up)' }))).toBe('orangery-wipe-in')
    expect(nameOf(effect({ filter: 'circle' }))).toBe('orangery-zoom-in')
  })

  it('pulses for an emphasis, whatever it was meant to be', () => {
    expect(nameOf(effect({ kind: 'emphasis', filter: null }))).toBe('orangery-pulse')
  })

  it('fades for an effect nobody here models', () => {
    // The rule the transitions already follow. A shape that appeared when it
    // should have spun makes a slide that reads correctly.
    expect(nameOf(effect({ filter: 'barn(inVertical)' }))).toBe('orangery-fade-in')
  })

  it('takes the length and the wait from the file', () => {
    const style = effectStyle(effect({ duration: 1200, delay: 300 }))
    expect(style.animationDuration).toBe('1200ms')
    expect(style.animationDelay).toBe('300ms')
  })

  it('holds what it ended on, so an exit stays gone', () => {
    expect(effectStyle(effect({ kind: 'exit' })).animationFillMode).toBe('both')
  })

  it('uses PowerPoint’s own default where the file states no length', () => {
    expect(effectStyle(effect({ duration: null })).animationDuration).toBe('500ms')
  })
})
