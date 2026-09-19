import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { compareXml, getPartText, readPackage } from '@orangery/ooxml-core'
import { applyChartEdits, readChart } from '@orangery/charts'
import { openDocx, saveDocx } from './docx-file'

/**
 * A chart in a document, saved.
 *
 * The node holds the chart part's XML and the save writes it back, so these
 * ask the two questions that follow from that: an untouched chart must come
 * back untouched, and an edited one must reach the file.
 */

const CHART_PART =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  '<c:style val="34"/><c:chart><c:plotArea><c:barChart><c:barDir val="col"/>' +
  '<c:ser><c:val><c:numRef><c:numCache><c:ptCount val="2"/>' +
  '<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>' +
  '</c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
  '<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx></c:plotArea>' +
  '<c:legend><c:legendPos val="b"/></c:legend></c:chart>' +
  '<c:extLst><c:ext uri="{FF}"><c16:x xmlns:c16="c16"/></c:ext></c:extLst></c:chartSpace>'

const DRAWING =
  '<w:drawing><wp:inline><wp:extent cx="5486400" cy="3200400"/><wp:docPr id="2" name="Chart 2"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/>' +
  '</a:graphicData></a:graphic></wp:inline></w:drawing>'

/** A document of one paragraph holding one chart. */
async function document(): Promise<Uint8Array> {
  const zip = new JSZip()

  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>' +
      '</Relationships>',
  )
  zip.file('word/charts/chart1.xml', CHART_PART)
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      `<w:body><w:p><w:r>${DRAWING}</w:r></w:p></w:body></w:document>`,
  )

  return zip.generateAsync({ type: 'uint8array' })
}

const chartIn = async (bytes: Uint8Array) => {
  const pkg = await readPackage(bytes)
  return getPartText(pkg, 'word/charts/chart1.xml') ?? ''
}

describe('a chart through a save', () => {
  it('comes back exactly as it was when nobody touched it', async () => {
    const open = await openDocx(await document())
    const written = await saveDocx(open, open.doc)

    expect(await chartIn(written)).toBe(CHART_PART)
  })

  it('carries an edit to the part the file holds', async () => {
    const open = await openDocx(await document())

    // What the panel does: the node holds the chart, and the edit goes into
    // the node.
    const node = open.doc.content?.[0]?.content?.[0]
    const xml = node?.attrs?.['chart']
    const edited = applyChartEdits(typeof xml === 'string' ? xml : '', [
      { kind: 'legend', position: 't' },
    ])
    if (node?.attrs === undefined || edited === null) throw new Error('the edit changed nothing')
    node.attrs['chart'] = edited

    const written = await saveDocx(open, open.doc)
    const saved = await chartIn(written)

    expect(readChart(saved)?.legend).toBe('t')
    // And everything the edit was not about is still in the part.
    expect(saved).toContain('c16:x')
    expect(saved).toContain('<c:style val="34"/>')
    expect(saved).toContain('<c:v>10</c:v>')
  })

  it('leaves the drawing in the body alone, edit or no edit', async () => {
    const open = await openDocx(await document())
    const written = await saveDocx(open, open.doc)
    const pkg = await readPackage(written)

    expect(getPartText(pkg, 'word/document.xml')).toContain('r:id="rId9"')
    expect(getPartText(pkg, 'word/document.xml')).toContain('name="Chart 2"')
  })
})

describe('what an edit changes in the file', () => {
  /** The document, with one property of its chart changed in the node. */
  const editedDocument = async () => {
    const open = await openDocx(await document())
    const node = open.doc.content?.[0]?.content?.[0]
    const xml = node?.attrs?.['chart']

    const edited = applyChartEdits(typeof xml === 'string' ? xml : '', [
      { kind: 'legend', position: 't' },
    ])
    if (node?.attrs === undefined || edited === null) throw new Error('the edit changed nothing')

    node.attrs['chart'] = edited
    return open
  }

  it('changes the legend and nothing else in the chart part', async () => {
    const open = await editedDocument()
    const written = await saveDocx(open, open.doc)

    const changed = compareXml(CHART_PART, await chartIn(written))
    expect(changed).toHaveLength(1)
    expect(changed[0]?.path).toContain('c:legend')
  })

  it('leaves every other part of the package where it was', async () => {
    const open = await editedDocument()
    const pkg = await readPackage(await saveDocx(open, open.doc))

    // The relationships and the content types are untouched: an edit to a
    // chart is an edit to one part, not a rearrangement of the package.
    expect(getPartText(pkg, 'word/_rels/document.xml.rels')).toContain('charts/chart1.xml')
    expect(getPartText(pkg, '[Content_Types].xml')).toContain('word/document.xml')
  })
})
