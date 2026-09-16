import { beforeEach, describe, expect, it } from 'vitest'
import { clampZoom, MAX_ZOOM, MIN_ZOOM, steppedZoom, useViewStore } from './view-store'

beforeEach(() => {
  useViewStore.getState().resetZoom()
})

describe('clampZoom', () => {
  it('keeps a value in range', () => {
    expect(clampZoom(1.25)).toBe(1.25)
  })

  it('clamps to the supported range', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
  })

  it('rounds to whole percent', () => {
    expect(clampZoom(1.23456)).toBe(1.23)
  })

  it('falls back to 100% for non-finite input', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})

describe('steppedZoom', () => {
  it('steps up through the ladder', () => {
    expect(steppedZoom(1, 1)).toBe(1.25)
  })

  it('steps down through the ladder', () => {
    expect(steppedZoom(1, -1)).toBe(0.9)
  })

  it('stops at the ends rather than going past them', () => {
    expect(steppedZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(steppedZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('steps from a value that is not on the ladder', () => {
    expect(steppedZoom(1.1, 1)).toBe(1.25)
    expect(steppedZoom(1.1, -1)).toBe(1)
  })
})

describe('view store', () => {
  it('starts at 100%', () => {
    expect(useViewStore.getState().zoom).toBe(1)
  })

  it('zooms in and out', () => {
    useViewStore.getState().zoomIn()
    expect(useViewStore.getState().zoom).toBe(1.25)

    useViewStore.getState().zoomOut()
    expect(useViewStore.getState().zoom).toBe(1)
  })

  it('resets to 100%', () => {
    useViewStore.getState().setZoom(1.75)
    useViewStore.getState().resetZoom()
    expect(useViewStore.getState().zoom).toBe(1)
  })

  it('clamps a zoom set directly', () => {
    useViewStore.getState().setZoom(99)
    expect(useViewStore.getState().zoom).toBe(MAX_ZOOM)
  })

  it('toggles the outline panel', () => {
    const before = useViewStore.getState().outlineOpen
    useViewStore.getState().toggleOutline()
    expect(useViewStore.getState().outlineOpen).toBe(!before)
    useViewStore.getState().toggleOutline()
  })
})
