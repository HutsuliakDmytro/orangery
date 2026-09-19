import { parseXml } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { parseChartDrawing } from './chart'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'

const CHART = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="5486400" cy="3200400"/>
<wp:docPr id="2" name="Chart 2"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId4"/>
</a:graphicData></a:graphic></wp:inline></w:drawing>`

const PICTURE = `<w:drawing><wp:inline><wp:extent cx="1" cy="1"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="p"><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing>`

const node = (xml: string) => parseXml(xml)[0]

describe('parseChartDrawing', () => {
  it('reads the relationship id of the chart part', () => {
    const drawing = node(CHART)
    expect(drawing && parseChartDrawing(drawing)?.relationshipId).toBe('rId4')
  })

  it('reads the frame size in points', () => {
    const drawing = node(CHART)
    const chart = drawing && parseChartDrawing(drawing)

    expect(chart?.width).toBe(432)
    expect(chart?.height).toBe(252)
  })

  it('keeps the drawing whole, because saving writes it back as it was', () => {
    const drawing = node(CHART)
    expect(drawing && parseChartDrawing(drawing)?.drawing).toContain('wp:docPr')
  })

  it('reads a 2016 chart too, which is framed rather than drawn', () => {
    const chartEx = node(
      '<w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>' +
        '<a:graphic xmlns:a="a"><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex">' +
        '<cx:chart xmlns:cx="cx" r:id="rId9"/></a:graphicData></a:graphic></wp:inline></w:drawing>',
    )

    expect(chartEx && parseChartDrawing(chartEx)?.relationshipId).toBe('rId9')
  })

  it('leaves a picture alone, which is a different graphic', () => {
    const drawing = node(PICTURE)
    expect(drawing && parseChartDrawing(drawing)).toBeNull()
  })
})

describe('a chart in a document', () => {
  const documentWith = (drawing: string) =>
    `<w:document xmlns:w="w"><w:body><w:p><w:r>${drawing}</w:r></w:p></w:body></w:document>`

  it('becomes a chart node rather than a preserved unknown', () => {
    const parsed = parseDocument(documentWith(CHART), {
      resolveChart: () => '<c:chartSpace/>',
      themeColors: [['accent1', '#FF0000']],
    })

    const paragraph = parsed.doc.content?.[0]
    expect(paragraph?.content?.[0]?.type).toBe('documentChart')
    expect(paragraph?.content?.[0]?.attrs?.['relationshipId']).toBe('rId4')
  })

  it('carries the part it is drawn from and the theme it is coloured by', () => {
    const parsed = parseDocument(documentWith(CHART), {
      resolveChart: () => '<c:chartSpace>read me</c:chartSpace>',
      themeColors: [['accent1', '#FF0000']],
    })

    const chart = parsed.doc.content?.[0]?.content?.[0]
    expect(chart?.attrs?.['chart']).toContain('read me')
    expect(chart?.attrs?.['themeColors']).toEqual([['accent1', '#FF0000']])
  })

  it('warns about nothing, because nothing about it is lost', () => {
    // It used to fall through to the passthrough below, which drew an empty
    // space and told the user the document might not display.
    const parsed = parseDocument(documentWith(CHART))
    expect(parsed.warnings).toEqual([])
  })

  it('goes back into the file exactly as it came', () => {
    const parsed = parseDocument(documentWith(CHART), { resolveChart: () => '<c:chartSpace/>' })
    const written = serializeDocument(parsed.doc, {
      documentAttributes: parsed.documentAttributes,
      sectionProperties: parsed.sectionProperties,
    })

    expect(written).toContain('r:id="rId4"')
    expect(written).toContain('cx="5486400"')
    expect(written).toContain('name="Chart 2"')
  })

  it('round-trips a chart whose part could not be read', () => {
    // A file whose chart part is missing still has the drawing, and a save
    // that dropped it would lose the chart from the document.
    const parsed = parseDocument(documentWith(CHART))
    const written = serializeDocument(parsed.doc, {
      documentAttributes: parsed.documentAttributes,
      sectionProperties: parsed.sectionProperties,
    })

    expect(written).toContain('r:id="rId4"')
  })
})
