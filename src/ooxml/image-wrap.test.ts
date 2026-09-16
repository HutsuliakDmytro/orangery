import { describe, expect, it } from 'vitest'
import { buildDrawing, parseDrawing } from './image'
import { parseXml, serializeNode } from './xml'

const node = (xml: string) => parseXml(xml)[0]

const anchored = (wrapElement: string, extra = '') => `<w:drawing><wp:anchor distT="0">
  ${extra}
  <wp:extent cx="2743200" cy="1828800"/>
  ${wrapElement}
  <wp:docPr id="1" name="Picture 1"/>
  <a:graphic xmlns:a="x"><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
</wp:anchor></w:drawing>`

describe('parseWrap', () => {
  it('reads topAndBottom', () => {
    expect(parseDrawing(node(anchored('<wp:wrapTopAndBottom/>')) as never)?.wrap).toBe(
      'topAndBottom',
    )
  })

  it('maps wrapText to the opposite side, which is where the image sits', () => {
    // `wrapText="right"` means text may sit to the right, so the image is left.
    expect(parseDrawing(node(anchored('<wp:wrapSquare wrapText="right"/>')) as never)?.wrap).toBe(
      'left',
    )
    expect(parseDrawing(node(anchored('<wp:wrapSquare wrapText="left"/>')) as never)?.wrap).toBe(
      'right',
    )
  })

  it('treats tight and through wrapping the same as square', () => {
    expect(parseDrawing(node(anchored('<wp:wrapTight wrapText="right"/>')) as never)?.wrap).toBe(
      'left',
    )
    expect(parseDrawing(node(anchored('<wp:wrapThrough wrapText="left"/>')) as never)?.wrap).toBe(
      'right',
    )
  })

  it('falls back to the horizontal alignment when wrapText says both sides', () => {
    const xml = anchored(
      '<wp:wrapSquare wrapText="bothSides"/>',
      '<wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>',
    )
    expect(parseDrawing(node(xml) as never)?.wrap).toBe('right')
  })

  it('refuses a drawing behind the text, which has no CSS equivalent', () => {
    // `wrapNone` would have to be flattened into the flow, moving it on the page.
    expect(parseDrawing(node(anchored('<wp:wrapNone/>')) as never)).toBeNull()
  })

  it('reads an inline drawing as inline', () => {
    const inline =
      '<w:drawing><wp:inline><wp:extent cx="100" cy="100"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
    expect(parseDrawing(node(inline) as never)?.wrap).toBe('inline')
  })
})

describe('buildDrawing with wrapping', () => {
  const build = (wrap: 'inline' | 'left' | 'right' | 'topAndBottom') =>
    serializeNode(
      buildDrawing({ relationshipId: 'rId5', width: 216, height: 144, alt: '', id: 2, wrap }),
    )

  it('writes an inline drawing for inline images', () => {
    expect(build('inline')).toContain('wp:inline')
    expect(build('inline')).not.toContain('wp:anchor')
  })

  it('writes an anchor for a wrapped image', () => {
    expect(build('left')).toContain('wp:anchor')
    expect(build('left')).toContain('wp:wrapSquare')
  })

  it('writes wrapText on the side opposite the image', () => {
    expect(build('left')).toContain('wrapText="right"')
    expect(build('right')).toContain('wrapText="left"')
  })

  it('writes wrapTopAndBottom for break-text', () => {
    expect(build('topAndBottom')).toContain('wp:wrapTopAndBottom')
  })

  it('round-trips every wrap style through the parser', () => {
    for (const wrap of ['inline', 'left', 'right', 'topAndBottom'] as const) {
      const built = buildDrawing({
        relationshipId: 'rId5',
        width: 216,
        height: 144,
        alt: '',
        id: 2,
        wrap,
      })
      expect(parseDrawing(built)?.wrap, wrap).toBe(wrap)
    }
  })

  it('keeps the size and relationship in the anchored form', () => {
    const parsed = parseDrawing(
      buildDrawing({
        relationshipId: 'rId7',
        width: 216,
        height: 144,
        alt: 'x',
        id: 3,
        wrap: 'right',
      }),
    )
    expect(parsed?.relationshipId).toBe('rId7')
    expect(parsed?.width).toBe(216)
    expect(parsed?.alt).toBe('x')
  })
})
