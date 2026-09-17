import { describe, expect, it } from 'vitest'
import { createTestEditor } from '../test/editor-harness'
import { DEFAULT_SECTION, serializeSection, withOrientation } from '../ooxml/section'
import { sectionAt, sectionsOf } from './sections'

const landscape = serializeSection(withOrientation(DEFAULT_SECTION, 'landscape'))

/**
 * A document of paragraphs with breaks where the marks say.
 *
 * The shape is written with one plain character per block, so splitting it into
 * code units is exactly right — there is nothing richer in it to mishandle.
 */
// eslint-disable-next-line @typescript-eslint/no-misused-spread -- see above
function documentOf(shape: string) {
  const content = shape.split('').map((mark) =>
    mark === '|'
      ? { type: 'sectionBreak', attrs: { sectPr: landscape } }
      : { type: 'paragraph', content: [{ type: 'text', text: mark }] },
  )

  return createTestEditor({ type: 'doc', content } as never)
}

describe('sectionsOf', () => {
  it('finds one section in a document with no breaks', () => {
    const editor = documentOf('ab')
    const sections = sectionsOf(editor.state.doc, DEFAULT_SECTION)

    expect(sections).toHaveLength(1)
    expect(sections[0]?.breakPosition).toBeNull()
    editor.destroy()
  })

  it('ends a section at the break that carries its setup', () => {
    const editor = documentOf('a|b')
    const sections = sectionsOf(editor.state.doc, DEFAULT_SECTION)

    expect(sections).toHaveLength(2)
    // The break carries the setup of the text above it, not below.
    expect(sections[0]?.properties.orientation).toBe('landscape')
    expect(sections[1]?.properties.orientation).toBe('portrait')
    editor.destroy()
  })

  it('gives the last section the setup held for the body', () => {
    const editor = documentOf('a|b')
    const sections = sectionsOf(editor.state.doc, withOrientation(DEFAULT_SECTION, 'landscape'))

    expect(sections[1]?.properties.orientation).toBe('landscape')
    editor.destroy()
  })

  it('counts a break with nothing after it as ending the section before it', () => {
    const editor = documentOf('a|')
    expect(sectionsOf(editor.state.doc, DEFAULT_SECTION)).toHaveLength(2)
    editor.destroy()
  })
})

describe('sectionAt', () => {
  it('puts a position before the break in the section that break ends', () => {
    const editor = documentOf('a|b')
    const section = sectionAt(editor.state.doc, 1, DEFAULT_SECTION)

    expect(section.breakPosition).not.toBeNull()
    expect(section.properties.orientation).toBe('landscape')
    editor.destroy()
  })

  it('puts a position after the break in the one the body holds', () => {
    const editor = documentOf('a|b')
    const last = editor.state.doc.content.size - 1
    const section = sectionAt(editor.state.doc, last, DEFAULT_SECTION)

    expect(section.breakPosition).toBeNull()
    editor.destroy()
  })

  it('always finds a section, even past the end', () => {
    const editor = documentOf('a')
    expect(sectionAt(editor.state.doc, 9999, DEFAULT_SECTION).breakPosition).toBeNull()
    editor.destroy()
  })
})
