import { describe, expect, it } from 'vitest'
import { captionKindOf, numberCaptions } from './captions'
import type { CaptionSource } from './captions'

const heading = (level: number): CaptionSource => ({ type: 'heading', level })
const figure = (): CaptionSource => ({ type: 'paragraph', captionKind: 'figure' })
const table = (): CaptionSource => ({ type: 'paragraph', captionKind: 'table' })
const text = (): CaptionSource => ({ type: 'paragraph' })

const numbers = (blocks: CaptionSource[], chapters = false) =>
  numberCaptions(blocks, chapters).map((caption) => caption.number)

describe('captionKindOf', () => {
  it('accepts only the kinds there are', () => {
    expect(captionKindOf('figure')).toBe('figure')
    expect(captionKindOf('diagram')).toBeUndefined()
    expect(captionKindOf(null)).toBeUndefined()
  })
})

describe('numberCaptions', () => {
  it('counts each kind separately', () => {
    expect(numbers([figure(), table(), figure(), table()])).toEqual(['1', '1', '2', '2'])
  })

  it('ignores the blocks between them', () => {
    expect(numbers([figure(), text(), heading(2), figure()])).toEqual(['1', '2'])
  })

  it('counts within a chapter when the chapters are numbered', () => {
    expect(numbers([heading(1), figure(), figure(), heading(1), figure()], true)).toEqual([
      '1.1',
      '1.2',
      '2.1',
    ])
  })

  it('restarts each kind at a chapter, not just the one that appeared', () => {
    expect(numbers([heading(1), figure(), table(), heading(1), table()], true)).toEqual([
      '1.1',
      '1.1',
      '2.1',
    ])
  })

  it('leaves a deeper heading alone, since chapters are the top level', () => {
    expect(numbers([heading(1), figure(), heading(2), figure()], true)).toEqual(['1.1', '1.2'])
  })

  it('numbers a caption that comes before any chapter as chapter zero', () => {
    // The gap is left visible rather than promoted: a figure above the first
    // heading is something the writer can see is out of place.
    expect(numbers([figure(), heading(1), figure()], true)).toEqual(['0.1', '1.1'])
  })

  it('says which block each number belongs to', () => {
    const found = numberCaptions([text(), figure(), text(), table()], false)
    expect(found.map((caption) => caption.index)).toEqual([1, 3])
    expect(found.map((caption) => caption.kind)).toEqual(['figure', 'table'])
  })

  it('carries no chapter when the chapters are not numbered', () => {
    expect(numberCaptions([figure()], false)[0]?.chapter).toBeNull()
  })
})
