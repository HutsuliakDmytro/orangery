import { parseXml } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { readListStyle, readTextBody, textOfBody } from './text-body'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

const body = (inner: string) => readTextBody(node(`<p:txBody>${inner}</p:txBody>`))

describe('paragraphs and runs', () => {
  it('reads runs with their own properties', () => {
    const text = body(
      '<a:p><a:r><a:rPr sz="1800" b="1"/><a:t>bold </a:t></a:r>' +
        '<a:r><a:rPr sz="3200" i="1"/><a:t>big italic</a:t></a:r></a:p>',
    )
    const [paragraph] = text.paragraphs

    expect(paragraph?.runs.map((run) => run.text)).toEqual(['bold ', 'big italic'])
    expect(paragraph?.runs[0]?.properties).toMatchObject({ size: 18, bold: true })
    expect(paragraph?.runs[1]?.properties).toMatchObject({ size: 32, italic: true })
  })

  it('keeps a run that is only whitespace', () => {
    // A space between two formatted words is text, not an empty run to drop.
    const text = body('<a:p><a:r><a:t> </a:t></a:r></a:p>')
    expect(text.paragraphs[0]?.runs[0]?.text).toBe(' ')
  })

  it('reads a line break as a run of its own', () => {
    const text = body('<a:p><a:r><a:t>one</a:t></a:r><a:br/><a:r><a:t>two</a:t></a:r></a:p>')
    expect(text.paragraphs[0]?.runs.map((run) => run.kind)).toEqual(['text', 'break', 'text'])
  })

  it('reads a field with the result PowerPoint cached in it', () => {
    const text = body('<a:p><a:fld id="x" type="slidenum"><a:t>3</a:t></a:fld></a:p>')
    const [run] = text.paragraphs[0]?.runs ?? []

    expect(run).toMatchObject({ kind: 'field', fieldType: 'slidenum', text: '3' })
  })

  it('keeps endParaRPr, which is all an empty paragraph has', () => {
    // Dropping it loses the formatting of every blank line in a deck.
    const text = body('<a:p><a:endParaRPr sz="2400" b="1"/></a:p>')

    expect(text.paragraphs[0]?.runs).toEqual([])
    expect(text.paragraphs[0]?.endProperties).toMatchObject({ size: 24, bold: true })
  })

  it('reads a run colour as something the theme resolves later', () => {
    const text = body(
      '<a:p><a:r><a:rPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>x</a:t></a:r></a:p>',
    )
    expect(text.paragraphs[0]?.runs[0]?.properties?.color?.source).toEqual({
      kind: 'scheme',
      name: 'accent1',
    })
  })

  it('leaves a theme font reference as written', () => {
    // `+mn-lt` is resolved against the theme when drawing, never at parse time.
    const text = body(
      '<a:p><a:r><a:rPr><a:latin typeface="+mn-lt"/></a:rPr><a:t>x</a:t></a:r></a:p>',
    )
    expect(text.paragraphs[0]?.runs[0]?.properties?.font).toBe('+mn-lt')
  })
})

describe('paragraph properties', () => {
  it('reads the outline level, which everything inherits along', () => {
    const text = body('<a:p><a:pPr lvl="2"/><a:r><a:t>x</a:t></a:r></a:p>')
    expect(text.paragraphs[0]?.properties.level).toBe(2)
  })

  it('defaults the level to zero when the paragraph states none', () => {
    const text = body('<a:p><a:r><a:t>x</a:t></a:r></a:p>')
    expect(text.paragraphs[0]?.properties.level).toBe(0)
  })

  it('tells a proportional line spacing from an absolute one', () => {
    const percent = body('<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr></a:p>')
    const points = body('<a:p><a:pPr><a:spcBef><a:spcPts val="1200"/></a:spcBef></a:pPr></a:p>')

    expect(percent.paragraphs[0]?.properties.lineSpacing).toEqual({ kind: 'percent', value: 1.5 })
    expect(points.paragraphs[0]?.properties.spaceBefore).toEqual({ kind: 'points', value: 12 })
  })

  it('reads a hanging indent as a negative first line', () => {
    const text = body('<a:p><a:pPr marL="342900" indent="-342900"/></a:p>')
    expect(text.paragraphs[0]?.properties).toMatchObject({ marginLeft: 342900, indent: -342900 })
  })
})

describe('bullets', () => {
  it('reads a character bullet with the font that has the glyph', () => {
    const text = body('<a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr></a:p>')
    expect(text.paragraphs[0]?.properties.bullet).toEqual({
      kind: 'character',
      character: '•',
      font: 'Arial',
    })
  })

  it('reads an automatic number with its scheme', () => {
    const text = body('<a:p><a:pPr><a:buAutoNum type="alphaLcParenR" startAt="3"/></a:pPr></a:p>')
    expect(text.paragraphs[0]?.properties.bullet).toEqual({
      kind: 'autoNumber',
      scheme: 'alphaLcParenR',
      startAt: 3,
    })
  })

  it('tells "no bullet" from "nothing said about bullets"', () => {
    // buNone is a decision the file made; absence means inherit from the level.
    const none = body('<a:p><a:pPr><a:buNone/></a:pPr></a:p>')
    const silent = body('<a:p><a:pPr/></a:p>')

    expect(none.paragraphs[0]?.properties.bullet).toEqual({ kind: 'none' })
    expect(silent.paragraphs[0]?.properties.bullet).toBeNull()
  })

  it('reads a picture bullet as the relationship it points at', () => {
    const text = body('<a:p><a:pPr><a:buBlip><a:blip r:embed="rId9"/></a:buBlip></a:pPr></a:p>')
    expect(text.paragraphs[0]?.properties.bullet).toEqual({
      kind: 'picture',
      relationshipId: 'rId9',
    })
  })
})

describe('body properties', () => {
  it('reads insets, anchor and wrap', () => {
    const text = body('<a:bodyPr lIns="91440" tIns="45720" anchor="ctr" wrap="square"/>')

    expect(text.bodyProperties).toMatchObject({ anchor: 'ctr', wrap: 'square' })
    expect(text.bodyProperties?.insets).toMatchObject({ left: 91440, top: 45720 })
  })

  it('leaves an inset the shape does not state as null, not zero', () => {
    // Zero is a deliberate edge-to-edge box; absent takes PowerPoint's default.
    const text = body('<a:bodyPr/>')
    expect(text.bodyProperties?.insets.left).toBeNull()
  })

  it('keeps what autofit has already shrunk the text to', () => {
    // PowerPoint reads its own fontScale back. Recomputing without it would
    // resize the text of every deck on open.
    const text = body(
      '<a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>',
    )

    expect(text.bodyProperties?.autofit).toEqual({
      kind: 'normal',
      fontScale: 0.625,
      lineSpaceReduction: 0.2,
    })
  })

  it('tells the three autofit modes apart', () => {
    expect(body('<a:bodyPr><a:noAutofit/></a:bodyPr>').bodyProperties?.autofit?.kind).toBe('none')
    expect(body('<a:bodyPr><a:spAutoFit/></a:bodyPr>').bodyProperties?.autofit?.kind).toBe('shape')
    expect(body('<a:bodyPr/>').bodyProperties?.autofit).toBeNull()
  })

  it('reads columns', () => {
    const text = body('<a:bodyPr numCol="2" spcCol="457200"/>')
    expect(text.bodyProperties?.columns).toEqual({ count: 2, spacing: 457200 })
  })
})

describe('the list style', () => {
  it('reads the nine levels, zero-based', () => {
    // Written lvl1pPr through lvl9pPr and used as 0 through 8.
    const style = readListStyle(
      node(
        '<a:lstStyle><a:lvl1pPr marL="0"/><a:lvl2pPr marL="457200"/><a:lvl9pPr marL="4114800"/></a:lstStyle>',
      ),
    )

    expect([...style.keys()]).toEqual([0, 1, 8])
    expect(style.get(1)?.marginLeft).toBe(457200)
  })
})

describe('textOfBody', () => {
  it('joins runs within a paragraph and paragraphs with newlines', () => {
    const text = body(
      '<a:p><a:r><a:t>one </a:t></a:r><a:r><a:t>two</a:t></a:r></a:p><a:p><a:r><a:t>three</a:t></a:r></a:p>',
    )
    expect(textOfBody(text)).toBe('one two\nthree')
  })
})
