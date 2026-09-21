import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck } from './deck'
import { fieldValue, slideNumberOf } from './fields'
import { readPptxPackage } from './parts'

/**
 * What a field answers.
 *
 * The date tests name a locale, because the point is that the value comes from
 * the day rather than from the cache — not that a particular machine writes
 * September a particular way.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')
const DAY = new Date(2026, 8, 18, 14, 5)

describe('a field on a slide', () => {
  it('numbers the slide it is on, not the one it was saved on', () => {
    expect(fieldValue('slidenum', '7', { number: 3, now: DAY })).toBe('3')
  })

  it('falls back to the cached number where there is no slide', () => {
    // A layout shown as a slide: it has no place in the deck, and PowerPoint's
    // own `‹#›` is the cached text it carries.
    expect(fieldValue('slidenum', '‹#›', { number: null, now: DAY })).toBe('‹#›')
  })

  it('writes the day it is shown on rather than the day it was saved', () => {
    const shown = fieldValue('datetime1', '01/01/2020', { number: 1, now: DAY, locale: 'en-US' })
    expect(shown).toBe('9/18/2026')
  })

  it('writes a long date the way the locale writes one', () => {
    expect(fieldValue('datetime2', '', { number: 1, now: DAY, locale: 'en-GB' })).toContain(
      'September',
    )
  })

  it('keeps the cached text for a field nobody here understands', () => {
    expect(fieldValue('somethingelse', 'as saved', { number: 1, now: DAY })).toBe('as saved')
  })
})

describe('which number a slide is', () => {
  it('counts from one through the deck', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    const deck = readDeck(pkg)

    const third = deck.slides[2]
    if (third === undefined) throw new Error('fixture has fewer than three slides')
    expect(slideNumberOf(deck, third)).toBe(3)
  })

  it('counts from where the deck says it starts', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    const deck = readDeck(pkg)
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    // A deck that continues another one: its first slide is slide 12, and every
    // number after it is off by eleven if the attribute is ignored.
    expect(slideNumberOf({ ...deck, firstSlideNum: 12 }, first)).toBe(12)
  })

  it('gives a layout no number at all', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    const deck = readDeck(pkg)
    const layout = [...deck.layouts.values()][0]
    if (layout === undefined) throw new Error('fixture has no layouts')

    expect(slideNumberOf(deck, layout)).toBeNull()
  })
})
