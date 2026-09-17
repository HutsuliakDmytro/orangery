import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { tabStopsOf } from './tab-stops'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<p>text</p>')
})

afterEach(() => {
  editor.destroy()
})

const stops = () => tabStopsOf(editor.getAttributes('paragraph'))

describe('tab stops on a paragraph', () => {
  it('starts with none of its own', () => {
    expect(stops()).toEqual([])
  })

  it('takes a stop', () => {
    editor.commands.setTabStop({ position: 216, alignment: 'right', leader: 'dot' })

    expect(stops()).toEqual([{ position: 216, alignment: 'right', leader: 'dot' }])
  })

  it('keeps them sorted, since a tab goes to the next one on its right', () => {
    editor.commands.setTabStop({ position: 216, alignment: 'left', leader: 'none' })
    editor.commands.setTabStop({ position: 72, alignment: 'left', leader: 'none' })

    expect(stops().map((stop) => stop.position)).toEqual([72, 216])
  })

  it('replaces one already at that position rather than stacking them', () => {
    editor.commands.setTabStop({ position: 72, alignment: 'left', leader: 'none' })
    editor.commands.setTabStop({ position: 72, alignment: 'right', leader: 'dot' })

    expect(stops()).toEqual([{ position: 72, alignment: 'right', leader: 'dot' }])
  })

  it('removes one by position', () => {
    editor.commands.setTabStop({ position: 72, alignment: 'left', leader: 'none' })
    editor.commands.setTabStop({ position: 216, alignment: 'left', leader: 'none' })
    editor.commands.clearTabStop(72)

    expect(stops().map((stop) => stop.position)).toEqual([216])
  })

  it('goes back to having none of its own when the last one is removed', () => {
    // An empty list would say the paragraph declares no stops, which is a
    // different thing from declaring an empty set of them.
    editor.commands.setTabStop({ position: 72, alignment: 'left', leader: 'none' })
    editor.commands.clearTabStop(72)

    expect(editor.getAttributes('paragraph')['tabs']).toBeNull()
  })

  it('clears them all at once', () => {
    editor.commands.setTabStop({ position: 72, alignment: 'left', leader: 'none' })
    editor.commands.setTabStop({ position: 216, alignment: 'left', leader: 'none' })
    editor.commands.clearTabStops()

    expect(stops()).toEqual([])
  })

  it('applies to a heading as well', () => {
    editor.commands.setContent('<h2>title</h2>')
    editor.commands.setTabStop({ position: 72, alignment: 'left', leader: 'none' })

    expect(tabStopsOf(editor.getAttributes('heading'))).toHaveLength(1)
  })
})
