import { describe, expect, it } from 'vitest'
import { findChild, parseXml, serializeNode } from '@orangery/ooxml-core'
import { readBodyProperties } from './text-body'
import { autofitKindOf, writeBodyProperties } from './write-text-body'
import type { BodyChange } from './write-text-body'

/** How a text box holds its text: the box, not the words. */

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

function body(bodyProperties: string) {
  const node = parseXml(
    `<p:txBody ${NS}>${bodyProperties}<a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody>`,
  )[0]
  if (node === undefined) throw new Error('bad fixture')
  return node
}

/** Applies a change and gives back the XML it produced. */
function apply(bodyProperties: string, change: BodyChange) {
  const node = body(bodyProperties)
  const changed = writeBodyProperties(node, change)

  return { changed, xml: serializeNode(node), node }
}

/** What the reader makes of the body properties now on a node. */
function propertiesOf(node: ReturnType<typeof body>) {
  const element = findChild(node, 'a:bodyPr')
  if (element === undefined) throw new Error('the body states none')
  return readBodyProperties(element)
}

describe('where the text sits', () => {
  it('writes the anchor', () => {
    expect(apply('<a:bodyPr/>', { anchor: 'ctr' }).xml).toContain('anchor="ctr"')
  })

  it('clears it rather than writing the default in its place', () => {
    // A shape with no anchor takes the one its placeholder gives it; the two
    // look alike until the layout changes.
    const { xml } = apply('<a:bodyPr anchor="b"/>', { anchor: null })
    expect(xml).not.toContain('anchor')
  })

  it('makes the element for a body that states none', () => {
    const { xml } = apply('', { anchor: 't' })
    expect(xml).toContain('<a:bodyPr anchor="t"/>')
  })

  it('puts it before the paragraphs, as the schema has it', () => {
    const { xml } = apply('', { anchor: 't' })
    expect(xml.indexOf('a:bodyPr')).toBeLessThan(xml.indexOf('a:p>'))
  })
})

describe('wrapping and the space around the edge', () => {
  it('lets a line run past the box', () => {
    expect(apply('<a:bodyPr/>', { wrap: 'none' }).xml).toContain('wrap="none"')
  })

  it('writes the insets it is given and leaves the others', () => {
    const { xml } = apply('<a:bodyPr lIns="91440" tIns="45720"/>', {
      insets: { left: 0, bottom: 45720 },
    })

    expect(xml).toContain('lIns="0"')
    expect(xml).toContain('tIns="45720"')
    expect(xml).toContain('bIns="45720"')
  })

  it('clears an inset back to the default', () => {
    const { xml } = apply('<a:bodyPr lIns="0"/>', { insets: { left: null } })
    expect(xml).not.toContain('lIns')
  })

  it('refuses a negative inset, which is not a padding', () => {
    expect(apply('<a:bodyPr/>', { insets: { left: -100 } }).xml).toContain('lIns="0"')
  })
})

describe('what gives when there is more text than room', () => {
  it('writes exactly one of the three', () => {
    const { xml } = apply('<a:bodyPr><a:spAutoFit/></a:bodyPr>', { autofit: 'none' })

    expect(xml).toContain('a:noAutofit')
    expect(xml).not.toContain('spAutoFit')
  })

  it('asks for shrinking without claiming to know by how much', () => {
    // PowerPoint records what it has already shrunk the text to and reads its
    // own number back; a guess here would resize text on open.
    const { xml } = apply('<a:bodyPr/>', { autofit: 'shrink' })

    expect(xml).toContain('<a:normAutofit/>')
    expect(xml).not.toContain('fontScale')
  })

  it('keeps the scale PowerPoint wrote when nothing asks it to change', () => {
    const { xml } = apply('<a:bodyPr><a:normAutofit fontScale="62500"/></a:bodyPr>', {
      anchor: 'ctr',
    })
    expect(xml).toContain('fontScale="62500"')
  })

  it('reads back what a body states', () => {
    expect(autofitKindOf(body('<a:bodyPr><a:normAutofit/></a:bodyPr>'))).toBe('shrink')
    expect(autofitKindOf(body('<a:bodyPr><a:spAutoFit/></a:bodyPr>'))).toBe('shape')
    expect(autofitKindOf(body('<a:bodyPr><a:noAutofit/></a:bodyPr>'))).toBe('none')
    expect(autofitKindOf(body('<a:bodyPr/>'))).toBeNull()
  })
})

describe('columns', () => {
  it('writes the count and the gap', () => {
    const { xml } = apply('<a:bodyPr/>', { columns: { count: 2, spacing: 91440 } })

    expect(xml).toContain('numCol="2"')
    expect(xml).toContain('spcCol="91440"')
  })

  it('goes back to the single column that is the default', () => {
    const { xml } = apply('<a:bodyPr numCol="3" spcCol="91440"/>', { columns: null })

    expect(xml).not.toContain('numCol')
    expect(xml).not.toContain('spcCol')
  })

  it('refuses a count below one', () => {
    expect(apply('<a:bodyPr/>', { columns: { count: 0 } }).xml).toContain('numCol="1"')
  })
})

describe('what the model reads back', () => {
  it('agrees with what was written', () => {
    const node = body('<a:bodyPr/>')
    writeBodyProperties(node, {
      anchor: 'ctr',
      wrap: 'none',
      insets: { left: 0, top: 0, right: 0, bottom: 0 },
    })

    const properties = propertiesOf(node)
    expect(properties.anchor).toBe('ctr')
    expect(properties.wrap).toBe('none')
    expect(properties.insets).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('reports nothing done for a change that names nothing', () => {
    expect(writeBodyProperties(body('<a:bodyPr/>'), {})).toBe(false)
  })
})
