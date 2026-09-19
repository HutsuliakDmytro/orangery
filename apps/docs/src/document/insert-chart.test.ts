import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import { allSeries, readChart, writeCategoriesIn, writeValuesIn } from '@orangery/charts'
import { openSheet, readCell } from '@orangery/ooxml-spreadsheet'
import { addChart } from './insert-chart'
import { openDocx, saveDocx } from './docx-file'

/**
 * Putting a chart into a document.
 *
 * A chart is four parts pointing at each other. Three of them is a file Word
 * offers to repair, and nothing on screen would say so, which is why every
 * test here asks about more than one.
 */

const THEME =
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">' +
  '<a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1>' +
  '<a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
  '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
  '<a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office"/></a:themeElements></a:theme>'

/** An empty document with a theme, which is what a chart takes its colours from. */
async function document(): Promise<Uint8Array> {
  const zip = new JSZip()

  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
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
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
      '</Relationships>',
  )
  zip.file('word/theme/theme1.xml', THEME)
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Before the chart</w:t></w:r></w:p></w:body></w:document>',
  )

  return zip.generateAsync({ type: 'uint8array' })
}

const inserted = async (kind: 'bar' | 'pie' = 'bar') => {
  const open = await openDocx(await document())
  const chart = await addChart(open.pkg, kind, { width: 468, height: 280 }, 7)
  return { open, chart }
}

describe('adding a chart to a document', () => {
  it('writes the chart part and declares it', async () => {
    const { open, chart } = await inserted('pie')

    expect(readChart(chart.chart)?.plots[0]?.kind).toBe('pie')
    expect(getPartText(open.pkg, 'word/charts/chart1.xml')).toBe(chart.chart)
    expect(getPartText(open.pkg, '[Content_Types].xml')).toContain('/word/charts/chart1.xml')
  })

  it('writes the workbook Edit Data would open, with the same numbers', async () => {
    const { open } = await inserted()
    const bytes = open.pkg.parts.get('word/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes

    const workbook = await readPackage(bytes ?? new Uint8Array())
    const sheet = openSheet(workbook, 'xl/worksheets/sheet1.xml')
    if (sheet === null) throw new Error('the embedded workbook has no sheet')

    expect(readCell(sheet, 'B2', [])).toBe(4.3)
    expect(getPartText(open.pkg, '[Content_Types].xml')).toContain('Extension="xlsx"')
  })

  it('relates the document to the chart and the chart to its workbook', async () => {
    const { open, chart } = await inserted()

    expect(getPartText(open.pkg, 'word/_rels/document.xml.rels')).toContain(
      `Id="${chart.relationshipId}"`,
    )
    expect(getPartText(open.pkg, 'word/charts/_rels/chart1.xml.rels')).toContain(
      '../embeddings/Microsoft_Excel_Sheet1.xlsx',
    )
  })

  it('builds a drawing that points at the relationship it made', async () => {
    const { chart } = await inserted()

    expect(chart.drawing).toContain(`r:id="${chart.relationshipId}"`)
    // 468 points, in the EMU the format counts in.
    expect(chart.drawing).toContain('cx="5943600"')
  })

  it('hands over the theme the chart will be drawn in', async () => {
    const { chart } = await inserted()
    expect(chart.themeColors).toContainEqual(['accent1', '#4472C4'])
  })

  it('numbers a second chart apart from the first', async () => {
    const { open } = await inserted()
    await addChart(open.pkg, 'line', { width: 200, height: 120 }, 8)

    expect(open.pkg.parts.has('word/charts/chart2.xml')).toBe(true)
    expect(open.pkg.parts.has('word/embeddings/Microsoft_Excel_Sheet2.xlsx')).toBe(true)
  })
})

describe('an inserted chart through a save', () => {
  it('reaches the file, and comes back as the chart it was', async () => {
    const { open, chart } = await inserted()

    // What the command does after the parts are in: the node carries the part.
    open.doc.content?.push({
      type: 'paragraph',
      content: [
        {
          type: 'documentChart',
          attrs: {
            relationshipId: chart.relationshipId,
            width: chart.width,
            height: chart.height,
            drawing: chart.drawing,
            chart: chart.chart,
            themeColors: chart.themeColors,
          },
        },
      ],
    })

    const written = await saveDocx(open, open.doc)
    const pkg = await readPackage(written)
    const reopened = await openDocx(written)

    expect(getPartText(pkg, 'word/document.xml')).toContain(`r:id="${chart.relationshipId}"`)
    expect(pkg.parts.has('word/embeddings/Microsoft_Excel_Sheet1.xlsx')).toBe(true)

    // And the document that comes back has a chart node with numbers in it.
    const node = reopened.doc.content?.at(-1)?.content?.[0]
    const xml = node?.attrs?.['chart']
    const read = readChart(typeof xml === 'string' ? xml : '')

    expect(node?.type).toBe('documentChart')
    expect(read === null ? [] : allSeries(read)[0]?.values).toEqual([4.3, 2.5, 3.5, 4.5])
  })

  it('leaves the text that was there before it', async () => {
    const { open } = await inserted()
    const written = await saveDocx(open, open.doc)

    expect(getPartText(await readPackage(written), 'word/document.xml')).toContain(
      'Before the chart',
    )
  })
})

describe('the workbook behind an edited chart', () => {
  /** A document with a chart in it, as the insert command leaves one. */
  const withChart = async () => {
    const open = await openDocx(await document())
    const chart = await addChart(open.pkg, 'bar', { width: 468, height: 280 }, 7)

    open.doc.content?.push({
      type: 'paragraph',
      content: [
        {
          type: 'documentChart',
          attrs: {
            relationshipId: chart.relationshipId,
            width: chart.width,
            height: chart.height,
            drawing: chart.drawing,
            chart: chart.chart,
            themeColors: chart.themeColors,
          },
        },
      ],
    })

    return { open, node: open.doc.content?.at(-1)?.content?.[0] }
  }

  const cellsOf = async (bytes: Uint8Array | undefined) => {
    const workbook = await readPackage(bytes ?? new Uint8Array())
    return getPartText(workbook, 'xl/worksheets/sheet1.xml') ?? ''
  }

  it('follows a number changed in the chart', async () => {
    const { open, node } = await withChart()
    const xml = node?.attrs?.['chart']

    // What the data dialog does: the edit goes into the node.
    const edited = writeValuesIn(typeof xml === 'string' ? xml : '', {
      series: 0,
      values: [4.3, 99, 3.5, 4.5],
    })
    if (node?.attrs === undefined || edited === null) throw new Error('the edit changed nothing')
    node.attrs['chart'] = edited

    const saved = await readPackage(await saveDocx(open, open.doc))
    const sheet = await cellsOf(
      saved.parts.get('word/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes,
    )

    // Word rebuilds the cache from the workbook the moment anybody opens the
    // data, so a chart edited in only one of them loses the edit.
    expect(sheet).toContain('99')
    expect(readChart(getPartText(saved, 'word/charts/chart1.xml') ?? '')).not.toBeNull()
  })

  it('follows a renamed category', async () => {
    const { open, node } = await withChart()
    const xml = node?.attrs?.['chart']

    const edited = writeCategoriesIn(typeof xml === 'string' ? xml : '', {
      categories: ['Spring', 'Category 2', 'Category 3', 'Category 4'],
    })
    if (node?.attrs === undefined || edited === null) throw new Error('the edit changed nothing')
    node.attrs['chart'] = edited

    const saved = await readPackage(await saveDocx(open, open.doc))
    const sheet = await cellsOf(
      saved.parts.get('word/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes,
    )

    expect(sheet).toContain('Spring')
  })

  it('leaves the workbook alone when the chart was not edited', async () => {
    const { open } = await withChart()
    const before = open.pkg.parts.get('word/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes

    const saved = await readPackage(await saveDocx(open, open.doc))
    const after = saved.parts.get('word/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes

    expect(after).toEqual(before)
  })
})
