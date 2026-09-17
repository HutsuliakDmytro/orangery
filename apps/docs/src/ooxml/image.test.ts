import { parseXml, serializeNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { buildDrawing, parseDrawing } from './image'

const DRAWING = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="2743200" cy="1828800"/>
<wp:docPr id="1" name="Picture 1" descr="A photo"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`

const node = (xml: string) => parseXml(xml)[0]

describe('parseDrawing', () => {
  it('reads the relationship id', () => {
    const drawing = node(DRAWING)
    expect(drawing && parseDrawing(drawing)?.relationshipId).toBe('rId7')
  })

  it('reads the display size in points', () => {
    const drawing = node(DRAWING)
    const image = drawing && parseDrawing(drawing)
    expect(image?.width).toBe(216)
    expect(image?.height).toBe(144)
  })

  it('reads the alt text', () => {
    const drawing = node(DRAWING)
    expect(drawing && parseDrawing(drawing)?.alt).toBe('A photo')
  })

  it('keeps the original drawing for round-trip', () => {
    const drawing = node(DRAWING)
    expect(drawing && parseDrawing(drawing)?.drawing).toContain('wp:extent')
  })

  it('returns null for a floating image, which is a different shape', () => {
    const anchored = node(
      '<w:drawing><wp:anchor><wp:extent cx="1" cy="1"/></wp:anchor></w:drawing>',
    )
    expect(anchored && parseDrawing(anchored)).toBeNull()
  })

  it('returns null when there is no picture reference', () => {
    const empty = node('<w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing>')
    expect(empty && parseDrawing(empty)).toBeNull()
  })

  it('tolerates a missing extent rather than throwing', () => {
    const sizeless = node(
      '<w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>',
    )
    expect(sizeless && parseDrawing(sizeless)?.width).toBe(0)
  })
})

describe('buildDrawing', () => {
  const built = buildDrawing({
    relationshipId: 'rId9',
    width: 216,
    height: 144,
    alt: 'Chart',
    id: 3,
  })

  it('produces a drawing the parser reads back', () => {
    const parsed = parseDrawing(built)
    expect(parsed?.relationshipId).toBe('rId9')
    expect(parsed?.width).toBe(216)
    expect(parsed?.height).toBe(144)
    expect(parsed?.alt).toBe('Chart')
  })

  it('writes the size in EMU', () => {
    expect(serializeNode(built)).toContain('cx="2743200"')
  })

  it('declares the DrawingML namespaces Word requires', () => {
    const xml = serializeNode(built)
    expect(xml).toContain('drawingml/2006/main')
    expect(xml).toContain('drawingml/2006/picture')
  })

  it('omits the description when there is no alt text', () => {
    const bare = buildDrawing({ relationshipId: 'r', width: 1, height: 1, alt: '', id: 1 })
    expect(serializeNode(bare)).not.toContain('descr=')
  })
})
