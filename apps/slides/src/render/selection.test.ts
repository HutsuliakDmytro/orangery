import { describe, expect, it } from 'vitest'
import type { Shape } from '@orangery/ooxml-presentation'
import { boxFrom, enclosedBy, groupAfterEscape, groupToOpen, selectionTarget } from './selection'

/**
 * Which shape a click means.
 *
 * All of it is arithmetic on ids and boxes, which is the point: the rule is
 * easy to state and easy to get subtly wrong, and every case here is one a
 * person would hit within a minute of grouping something.
 */

const shape = (id: number, kind: Shape['kind'] = 'sp') => ({ id, kind }) as Shape

const leaf = shape(10)
const inner = shape(2, 'grpSp')
const outer = shape(1, 'grpSp')

describe('clicking a shape that is in no group', () => {
  it('selects the shape', () => {
    expect(selectionTarget({ shape: leaf, ancestors: [] }, null).id).toBe(10)
  })

  it('still selects the shape while some other group is open', () => {
    expect(selectionTarget({ shape: leaf, ancestors: [] }, 1).id).toBe(10)
  })
})

describe('clicking a shape inside a group', () => {
  const clicked = { shape: leaf, ancestors: [outer, inner] }

  it('selects the outermost group when nothing is open', () => {
    expect(selectionTarget(clicked, null).id).toBe(1)
  })

  it('selects the next group down when the outer one is open', () => {
    expect(selectionTarget(clicked, 1).id).toBe(2)
  })

  it('selects the shape itself once the inner group is open too', () => {
    expect(selectionTarget(clicked, 2).id).toBe(10)
  })

  it('starts from the top again when what is open is somewhere else', () => {
    // Clicking outside the group you are in is how you get out of it.
    expect(selectionTarget(clicked, 99).id).toBe(1)
  })
})

describe('double clicking', () => {
  it('opens the outermost group first, not the innermost', () => {
    expect(groupToOpen({ shape: leaf, ancestors: [outer, inner] }, null)).toBe(1)
  })

  it('opens the next one down once inside', () => {
    expect(groupToOpen({ shape: leaf, ancestors: [outer, inner] }, 1)).toBe(2)
  })

  it('opens nothing when the click lands on a plain shape', () => {
    expect(groupToOpen({ shape: leaf, ancestors: [] }, null)).toBeNull()
    expect(groupToOpen({ shape: leaf, ancestors: [outer, inner] }, 2)).toBeNull()
  })
})

describe('stepping back out', () => {
  it('goes up one level', () => {
    expect(groupAfterEscape(2, [outer, inner])).toBe(1)
  })

  it('reaches the top from the outermost group', () => {
    expect(groupAfterEscape(1, [outer, inner])).toBeNull()
  })

  it('is already out when nothing is open', () => {
    expect(groupAfterEscape(null, [outer, inner])).toBeNull()
  })

  it('is out when what is selected is not in the open group at all', () => {
    expect(groupAfterEscape(1, [])).toBeNull()
  })
})

describe('a marquee', () => {
  const band = { x: 0, y: 0, width: 100, height: 100 }

  it('catches a shape entirely inside it', () => {
    expect(enclosedBy({ x: 10, y: 10, width: 20, height: 20 }, band)).toBe(true)
  })

  it('catches one that exactly fills it', () => {
    expect(enclosedBy({ x: 0, y: 0, width: 100, height: 100 }, band)).toBe(true)
  })

  it('leaves one that only overlaps', () => {
    // The difference that matters on a crowded slide: with "touched", a band
    // dragged across the middle takes everything.
    expect(enclosedBy({ x: 90, y: 90, width: 50, height: 50 }, band)).toBe(false)
  })

  it('leaves one entirely outside', () => {
    expect(enclosedBy({ x: 200, y: 200, width: 10, height: 10 }, band)).toBe(false)
  })

  it('is built the same dragged in any direction', () => {
    const forwards = boxFrom({ x: 10, y: 20 }, { x: 110, y: 220 })
    const backwards = boxFrom({ x: 110, y: 220 }, { x: 10, y: 20 })

    expect(forwards).toEqual({ x: 10, y: 20, width: 100, height: 200 })
    expect(backwards).toEqual(forwards)
  })
})
