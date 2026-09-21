import { describe, expect, it } from 'vitest'
import { parseXml, serializeNode } from '@orangery/ooxml-core'
import { applyShapeFormat, copyShapeFormat } from './format-painter'
import { parseShape } from './shape-tree'
import type { Shape } from './shape-tree'

/**
 * Painting one shape's look onto another.
 *
 * What is checked is the XML, because that is what the next program to open the
 * file reads. A brush that changed the model and not the element would be a
 * change nobody outside this process ever sees.
 */

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

function shape(properties: string, text = '<a:p><a:r><a:t>Words</a:t></a:r></a:p>'): Shape {
  const xml =
    `<p:sp ${NS}><p:nvSpPr><p:cNvPr id="1" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${properties}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${text}</p:txBody></p:sp>`

  const node = parseXml(xml)[0]
  if (node === undefined) throw new Error('bad fixture')
  return parseShape(node)
}

/** Copies from one shape onto another and gives back the painted XML. */
function paint(from: Shape, onto: Shape): string {
  const format = copyShapeFormat(from)
  if (format === null) throw new Error('nothing to copy')

  expect(applyShapeFormat(onto, format)).toBe(true)
  return serializeNode(onto.node)
}

const ORANGE = '<a:solidFill><a:srgbClr val="FF7A00"/></a:solidFill>'
const LINE = '<a:ln w="38100"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>'

describe('what the brush carries', () => {
  it('takes the fill across', () => {
    const written = paint(
      shape(ORANGE),
      shape('<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>'),
    )

    expect(written).toContain('FF7A00')
    expect(written).not.toContain('00FF00')
  })

  it('takes the outline and the effects across', () => {
    const written = paint(
      shape(`${ORANGE}${LINE}<a:effectLst><a:outerShdw blurRad="50800"/></a:effectLst>`),
      shape(''),
    )

    expect(written).toContain('w="38100"')
    expect(written).toContain('a:outerShdw')
  })

  it('leaves a shape with nothing where a fill used to be', () => {
    // A gradient painted over by a shape stating none has to lose it: the
    // brush says "look like this", and this has no fill.
    const written = paint(shape('<a:noFill/>'), shape(ORANGE))

    expect(written).toContain('a:noFill')
    expect(written).not.toContain('FF7A00')
  })

  it('takes the theme slots across', () => {
    const from = parseXml(
      `<p:sp ${NS}><p:nvSpPr><p:cNvPr id="1" name="a"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr/><p:style><a:fillRef idx="2"><a:schemeClr val="accent3"/></a:fillRef></p:style>` +
        `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`,
    )[0]
    if (from === undefined) throw new Error('bad fixture')

    const written = paint(parseShape(from), shape(''))
    expect(written).toContain('accent3')
    // Before the text body, which is the order `p:sp` wants.
    expect(written.indexOf('p:style')).toBeLessThan(written.indexOf('p:txBody'))
  })
})

describe('what it leaves alone', () => {
  it('does not change what the shape is', () => {
    const written = paint(
      shape(`<a:prstGeom prst="rect"/>${ORANGE}`),
      shape('<a:prstGeom prst="rightArrow"/>'),
    )

    // A brush is not a way to turn an arrow into a rectangle.
    expect(written).toContain('rightArrow')
    expect(written).not.toContain('"rect"')
  })

  it('does not move it or resize it', () => {
    const written = paint(
      shape(`<a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>${ORANGE}`),
      shape('<a:xfrm><a:off x="900" y="900"/><a:ext cx="5000" cy="5000"/></a:xfrm>'),
    )

    expect(written).toContain('x="900"')
    expect(written).toContain('cx="5000"')
  })

  it('keeps the level a paragraph is at', () => {
    const written = paint(
      shape(ORANGE, '<a:p><a:pPr algn="ctr"/><a:r><a:t>From</a:t></a:r></a:p>'),
      shape('', '<a:p><a:pPr lvl="2"/><a:r><a:t>Onto</a:t></a:r></a:p>'),
    )

    // The second rung of a list is still the second rung after painting; how it
    // is aligned is how it looks, and that does travel.
    expect(written).toContain('lvl="2"')
    expect(written).toContain('algn="ctr"')
  })

  it('does not hand over a hyperlink', () => {
    const written = paint(
      shape(
        ORANGE,
        '<a:p><a:r><a:rPr b="1"><a:hlinkClick r:id="rId9"/></a:rPr><a:t>From</a:t></a:r></a:p>',
      ),
      shape('', '<a:p><a:r><a:t>Onto</a:t></a:r></a:p>'),
    )

    // A link belongs to the words it is on, not to how they look.
    expect(written).toContain('b="1"')
    expect(written).not.toContain('rId9')
  })

  it('keeps the link the painted words already had', () => {
    const written = paint(
      shape(ORANGE, '<a:p><a:r><a:rPr b="1"/><a:t>From</a:t></a:r></a:p>'),
      shape('', '<a:p><a:r><a:rPr><a:hlinkClick r:id="rId4"/></a:rPr><a:t>Onto</a:t></a:r></a:p>'),
    )

    expect(written).toContain('rId4')
    expect(written).toContain('b="1"')
  })

  it('keeps the language of the words it paints', () => {
    const written = paint(
      shape(ORANGE, '<a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>From</a:t></a:r></a:p>'),
      shape('', '<a:p><a:r><a:rPr lang="uk-UA"/><a:t>Слова</a:t></a:r></a:p>'),
    )

    expect(written).toContain('lang="uk-UA"')
    expect(written).not.toContain('en-US')
  })
})

describe('an empty paragraph', () => {
  it('is painted too, so what is typed next looks right', () => {
    const written = paint(
      shape(ORANGE, '<a:p><a:r><a:rPr sz="4000"/><a:t>Big</a:t></a:r></a:p>'),
      shape('', '<a:p/>'),
    )

    // An empty paragraph keeps its look in `a:endParaRPr` and nowhere else.
    expect(written).toContain('a:endParaRPr')
    expect(written).toContain('sz="4000"')
  })
})

describe('a shape with nothing to give', () => {
  it('is not something the brush can pick up from', () => {
    const frame = parseXml(`<p:graphicFrame ${NS}><p:nvGraphicFramePr/></p:graphicFrame>`)[0]
    if (frame === undefined) throw new Error('bad fixture')

    expect(copyShapeFormat(parseShape(frame))).toBeNull()
  })
})
