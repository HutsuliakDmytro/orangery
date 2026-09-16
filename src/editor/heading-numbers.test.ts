import { describe, expect, it } from 'vitest'
import { createTestEditor } from '../test/editor-harness'
import { headingNumbers, toAlpha, toRoman } from './heading-numbers'
import type { HeadingNumberScheme } from './heading-numbers'

/** Numbers the headings of a document written as HTML. */
function labels(html: string, scheme: HeadingNumberScheme = 'decimal'): string[] {
  const editor = createTestEditor(html)
  try {
    return headingNumbers(editor.state.doc, scheme).map((number) => number.label)
  } finally {
    editor.destroy()
  }
}

describe('toRoman', () => {
  it('writes the numerals', () => {
    expect([1, 4, 9, 14, 40, 1987].map(toRoman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'MCMLXXXVII'])
  })

  it('has nothing to write for zero', () => {
    expect(toRoman(0)).toBe('')
  })
})

describe('toAlpha', () => {
  it('carries into a second letter rather than running out', () => {
    expect([1, 26, 27, 52, 53].map(toAlpha)).toEqual(['a', 'z', 'aa', 'az', 'ba'])
  })
})

describe('headingNumbers', () => {
  it('numbers a flat run of headings', () => {
    expect(labels('<h1>a</h1><h1>b</h1><h1>c</h1>')).toEqual(['1.', '2.', '3.'])
  })

  it('carries every level above it', () => {
    // "1.2.3." says where a heading sits; "3." on its own does not.
    expect(labels('<h1>a</h1><h2>b</h2><h3>c</h3>')).toEqual(['1.', '1.1.', '1.1.1.'])
  })

  it('starts the deeper levels again under each heading', () => {
    expect(labels('<h1>a</h1><h2>b</h2><h2>c</h2><h1>d</h1><h2>e</h2>')).toEqual([
      '1.',
      '1.1.',
      '1.2.',
      '2.',
      '2.1.',
    ])
  })

  it('leaves the gap visible when a level is skipped', () => {
    // Quietly promoting the heading would renumber a document the writer can
    // see is wrong, and hide why.
    expect(labels('<h2>a</h2>')).toEqual(['0.1.'])
  })

  it('ignores the paragraphs between headings', () => {
    expect(labels('<h1>a</h1><p>text</p><h1>b</h1>')).toEqual(['1.', '2.'])
  })

  it('records where each heading sits, so the number can be drawn there', () => {
    const editor = createTestEditor('<p>intro</p><h1>a</h1>')
    const numbers = headingNumbers(editor.state.doc, 'decimal')

    expect(editor.state.doc.nodeAt(numbers[0]?.position ?? 0)?.type.name).toBe('heading')
    editor.destroy()
  })

  it('walks the outline gallery in the other scheme', () => {
    expect(labels('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4>', 'outline')).toEqual([
      'I.',
      'A.',
      '1.',
      'a)',
    ])
  })

  it('numbers each outline level on its own, without the ones above', () => {
    expect(labels('<h1>a</h1><h1>b</h1><h2>c</h2><h2>d</h2>', 'outline')).toEqual([
      'I.',
      'II.',
      'A.',
      'B.',
    ])
  })

  it('starts the gallery over past its fifth level', () => {
    expect(labels('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>', 'outline')).toEqual(
      ['I.', 'A.', '1.', 'a)', 'i)', 'I.'],
    )
  })
})
