import TextStyle from '@tiptap/extension-text-style'
import { describe, expect, it } from 'vitest'
import { clampLetterSpacing, RunStyle } from './run-style'
import { createTextEditor } from './test-editor'

/** The rest of what a run says about its characters, as editor attributes. */

const editor = () => createTextEditor([TextStyle, RunStyle], '<p>Words</p>')

const withAll = () => {
  const one = editor()
  one.commands.selectAll()
  return one
}

describe('the run attributes', () => {
  it('carries a colour', () => {
    const one = withAll()
    one.chain().setMark('textStyle', { color: '#FF7A00' }).run()

    expect(one.getAttributes('textStyle')['color']).toBe('#FF7A00')
  })

  it('carries a highlight', () => {
    const one = withAll()
    one.chain().setMark('textStyle', { highlight: '#FFFF00' }).run()

    expect(one.getAttributes('textStyle')['highlight']).toBe('#FFFF00')
  })

  it('carries capitals and letter spacing', () => {
    const one = withAll()
    one.chain().setMark('textStyle', { caps: 'small', letterSpacing: 1.5 }).run()

    expect(one.getAttributes('textStyle')['caps']).toBe('small')
    expect(one.getAttributes('textStyle')['letterSpacing']).toBe(1.5)
  })

  it('reads them back off the rendered HTML', () => {
    const one = withAll()
    one.chain().setMark('textStyle', { color: '#FF7A00', caps: 'all', letterSpacing: 2 }).run()

    const again = createTextEditor([TextStyle, RunStyle], one.getHTML())
    again.commands.selectAll()

    expect(again.getAttributes('textStyle')['color']).toBe('#FF7A00')
  })
})

describe('clamping letter spacing', () => {
  it('keeps two decimals and stays in range', () => {
    expect(clampLetterSpacing(1.234)).toBe(1.23)
    expect(clampLetterSpacing(1000)).toBe(100)
    expect(clampLetterSpacing(-1000)).toBe(-10)
    expect(clampLetterSpacing(Number.NaN)).toBe(0)
  })
})
