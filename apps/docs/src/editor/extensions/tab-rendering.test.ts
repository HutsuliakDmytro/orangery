import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { decodeStops, encodeStops, TAB_CLASS } from './tab-rendering'
import type { TabStop } from '../../ooxml/tabs'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<p></p>')
})

afterEach(() => {
  editor.destroy()
})

const stop = (position: number, extra: Partial<TabStop> = {}): TabStop => ({
  position,
  alignment: 'left',
  leader: 'none',
  ...extra,
})

describe('carrying the stops to the element', () => {
  it('round-trips a list of stops', () => {
    const stops = [stop(72), stop(216, { alignment: 'right', leader: 'dot' })]
    expect(decodeStops(encodeStops(stops))).toEqual(stops)
  })

  it('reads an empty encoding as no stops', () => {
    expect(decodeStops('')).toEqual([])
  })

  it('skips an entry with no position rather than placing a tab at zero', () => {
    expect(decodeStops('nonsense:left:none')).toEqual([])
  })
})

describe('marking the tabs in the document', () => {
  const tabs = () => editor.view.dom.querySelectorAll(`.${TAB_CLASS}`)

  it('marks nothing in a paragraph without one', () => {
    editor.commands.setContent('<p>plain text</p>')
    expect(tabs()).toHaveLength(0)
  })

  it('marks every tab character', () => {
    editor.commands.insertContent('a\tb\tc')
    expect(tabs()).toHaveLength(2)
  })

  it('gives each tab the stops of the paragraph it is in', () => {
    editor.commands.insertContent('a\tb')
    editor.commands.setTabStop(stop(216, { alignment: 'right', leader: 'dot' }))

    expect(tabs()[0]?.getAttribute('data-stops')).toBe('216:right:dot')
  })

  it('carries no stops for a paragraph that declares none', () => {
    editor.commands.insertContent('a\tb')
    expect(tabs()[0]?.getAttribute('data-stops')).toBe('')
  })

  it('follows the paragraph when its stops change', () => {
    editor.commands.insertContent('a\tb')
    editor.commands.setTabStop(stop(72))
    editor.commands.setTabStop(stop(216))

    expect(tabs()[0]?.getAttribute('data-stops')).toBe('72:left:none,216:left:none')
  })
})
