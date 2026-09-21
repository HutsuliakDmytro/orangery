import { describe, expect, it } from 'vitest'
import {
  adjustDrawingAnchors,
  drawingRelationshipId,
  readSheetDrawings,
  replaceDrawingReference,
  writeSheetDrawings,
} from './drawing'
import type { SheetDrawing } from './drawing'

/**
 * The things on a sheet, as the drawing part states them.
 *
 * Three anchors, three meanings: pinned at both corners and stretching with
 * the cells, pinned at one and keeping its size, or pinned to the sheet and
 * moving for nothing. What is read here is cells and EMU — turning those into
 * pixels needs the zoom and the column widths, which are not in this file.
 */

const wsDr = (body: string) =>
  readSheetDrawings(
    '<xdr:wsDr xmlns:xdr="xdr" xmlns:a="a" xmlns:r="r" xmlns:c="c">' + body + '</xdr:wsDr>',
  )

const CHART =
  '<xdr:graphicFrame><xdr:nvGraphicFramePr>' +
  '<xdr:cNvPr id="2" name="Spending"/></xdr:nvGraphicFramePr>' +
  '<a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic>' +
  '</xdr:graphicFrame>'

const PICTURE =
  '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Logo"/></xdr:nvPicPr>' +
  '<xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic>'

const from =
  '<xdr:from><xdr:col>1</xdr:col><xdr:colOff>9525</xdr:colOff>' +
  '<xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'

describe('where a drawing is pinned', () => {
  it('reads both corners of a two-cell anchor', () => {
    const [drawing] = wsDr(
      `<xdr:twoCellAnchor editAs="oneCell">${from}` +
        '<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff>' +
        `<xdr:row>18</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:to>${CHART}</xdr:twoCellAnchor>`,
    )

    expect(drawing?.anchor).toEqual({
      kind: 'two',
      from: { column: 1, columnOffset: 9525, row: 4, rowOffset: 0 },
      to: { column: 5, columnOffset: 0, row: 18, rowOffset: 19050 },
    })
    expect(drawing?.editAs).toBe('oneCell')
  })

  it('reads a one-cell anchor as a corner and a size', () => {
    const [drawing] = wsDr(
      `<xdr:oneCellAnchor>${from}<xdr:ext cx="914400" cy="457200"/>${PICTURE}</xdr:oneCellAnchor>`,
    )

    expect(drawing?.anchor).toMatchObject({ kind: 'one', width: 914_400, height: 457_200 })
  })

  it('reads an absolute anchor, which no cell can move', () => {
    const [drawing] = wsDr(
      '<xdr:absoluteAnchor><xdr:pos x="228600" y="114300"/>' +
        `<xdr:ext cx="914400" cy="457200"/>${PICTURE}</xdr:absoluteAnchor>`,
    )

    expect(drawing?.anchor).toEqual({
      kind: 'absolute',
      x: 228_600,
      y: 114_300,
      width: 914_400,
      height: 457_200,
    })
  })
})

describe('what a drawing holds', () => {
  it('finds the chart a graphic frame wraps, by the relationship it names', () => {
    const [drawing] = wsDr(
      `<xdr:oneCellAnchor>${from}<xdr:ext cx="1" cy="1"/>${CHART}` + '</xdr:oneCellAnchor>',
    )

    expect(drawing?.content).toEqual({ kind: 'chart', relationshipId: 'rId1' })
    expect(drawing?.name).toBe('Spending')
  })

  it('finds the image a picture embeds', () => {
    const [drawing] = wsDr(
      `<xdr:oneCellAnchor>${from}<xdr:ext cx="1" cy="1"/>${PICTURE}` + '</xdr:oneCellAnchor>',
    )

    expect(drawing?.content).toEqual({ kind: 'picture', relationshipId: 'rId2' })
  })

  it('keeps a shape it cannot draw rather than dropping it from the list', () => {
    // Something that vanished from the model is something nobody notices is
    // missing; a sheet that says it has three drawings can say so.
    const [drawing] = wsDr(
      `<xdr:oneCellAnchor>${from}<xdr:ext cx="1" cy="1"/>` +
        '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="4" name="Arrow"/></xdr:nvSpPr></xdr:sp>' +
        '</xdr:oneCellAnchor>',
    )

    expect(drawing?.content).toEqual({ kind: 'other', what: 'sp' })
    expect(drawing?.name).toBe('Arrow')
  })

  it('keeps them in the order they are drawn in, which is the order they stack', () => {
    const drawings = wsDr(
      `<xdr:oneCellAnchor>${from}<xdr:ext cx="1" cy="1"/>${CHART}</xdr:oneCellAnchor>` +
        `<xdr:oneCellAnchor>${from}<xdr:ext cx="1" cy="1"/>${PICTURE}</xdr:oneCellAnchor>`,
    )

    expect(drawings.map((one) => one.content.kind)).toEqual(['chart', 'picture'])
  })

  it('ignores a prefix it has not seen before, since a prefix is not a name', () => {
    const drawings = readSheetDrawings(
      '<wsDr xmlns="xdr" xmlns:a="a" xmlns:r="r" xmlns:c="c"><oneCellAnchor>' +
        '<from><col>2</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></from>' +
        '<ext cx="1" cy="1"/>' +
        '<pic><nvPicPr><cNvPr id="3" name="Logo"/></nvPicPr>' +
        '<blipFill><a:blip r:embed="rId9"/></blipFill></pic>' +
        '</oneCellAnchor></wsDr>',
    )

    expect(drawings[0]?.content).toEqual({ kind: 'picture', relationshipId: 'rId9' })
  })
})

describe('the drawing part a sheet points at', () => {
  it('is the relationship the sheet names', () => {
    const id = drawingRelationshipId(
      '<worksheet xmlns="x" xmlns:r="r"><sheetData/><drawing r:id="rId4"/></worksheet>',
    )

    expect(id).toBe('rId4')
  })

  it('is nothing for a sheet with nothing on it', () => {
    expect(drawingRelationshipId('<worksheet xmlns="x"><sheetData/></worksheet>')).toBeNull()
  })
})

describe('writing the drawings of a sheet back', () => {
  const chart = (relationshipId: string): SheetDrawing => ({
    anchor: {
      kind: 'two',
      from: { column: 1, columnOffset: 0, row: 2, rowOffset: 0 },
      to: { column: 8, columnOffset: 0, row: 17, rowOffset: 0 },
    },
    content: { kind: 'chart', relationshipId },
    name: 'Chart 1',
    editAs: 'oneCell',
  })

  it('comes back the same through a round trip', () => {
    const before = [chart('rId1')]
    expect(readSheetDrawings(writeSheetDrawings(before))).toEqual(before)
  })

  it('writes a picture as a picture and a chart as a frame', () => {
    const picture: SheetDrawing = {
      ...chart('rId2'),
      content: { kind: 'picture', relationshipId: 'rId2' },
    }

    expect(writeSheetDrawings([picture])).toContain('<xdr:pic>')
    expect(writeSheetDrawings([chart('rId1')])).toContain('<xdr:graphicFrame')
  })

  it('keeps the three ways of anchoring apart', () => {
    const one: SheetDrawing = {
      ...chart('rId1'),
      anchor: {
        kind: 'one',
        from: { column: 0, columnOffset: 0, row: 0, rowOffset: 0 },
        width: 1000,
        height: 500,
      },
    }
    const fixed: SheetDrawing = {
      ...chart('rId1'),
      anchor: { kind: 'absolute', x: 100, y: 200, width: 1000, height: 500 },
    }

    expect(readSheetDrawings(writeSheetDrawings([one]))[0]?.anchor).toEqual(one.anchor)
    expect(readSheetDrawings(writeSheetDrawings([fixed]))[0]?.anchor).toEqual(fixed.anchor)
  })

  it('tells a worksheet which drawing part is its own', () => {
    const sheet = '<?xml version="1.0"?><worksheet><sheetData/></worksheet>'
    expect(replaceDrawingReference(sheet, 'rId3')).toContain('<drawing r:id="rId3"/>')

    // Before the extension list, which is where the schema puts it.
    const extended = '<?xml version="1.0"?><worksheet><sheetData/><extLst/></worksheet>'
    const written = replaceDrawingReference(extended, 'rId3')
    expect(written.indexOf('<drawing')).toBeLessThan(written.indexOf('<extLst'))
  })

  it('replaces the reference a sheet already had rather than adding another', () => {
    const sheet = '<?xml version="1.0"?><worksheet><sheetData/><drawing r:id="rId9"/></worksheet>'
    const written = replaceDrawingReference(sheet, 'rId3')

    expect(written).toContain('rId3')
    expect(written).not.toContain('rId9')
  })
})

describe('a drawing after rows moved under it', () => {
  const anchor = (fromRow: number, toRow: number) =>
    '<?xml version="1.0"?><xdr:wsDr><xdr:twoCellAnchor>' +
    `<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${String(fromRow)}</xdr:row>` +
    '<xdr:rowOff>0</xdr:rowOff></xdr:from>' +
    `<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${String(toRow)}</xdr:row>` +
    '<xdr:rowOff>9525</xdr:rowOff></xdr:to>' +
    '<xdr:graphicFrame/><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>'

  it('moves down when the rows above it do', () => {
    const after = adjustDrawingAnchors(anchor(4, 20), { axis: 'row', at: 0, by: 2 })

    expect(after).toContain('<xdr:row>6</xdr:row>')
    expect(after).toContain('<xdr:row>22</xdr:row>')
  })

  it('gets taller when a row goes in under its top edge', () => {
    const after = adjustDrawingAnchors(anchor(4, 20), { axis: 'row', at: 10, by: 1 })

    expect(after).toContain('<xdr:row>4</xdr:row>')
    expect(after).toContain('<xdr:row>21</xdr:row>')
  })

  it('moves across for a column change and not for a row one', () => {
    const after = adjustDrawingAnchors(anchor(4, 20), { axis: 'column', at: 0, by: 1 })

    expect(after).toContain('<xdr:col>2</xdr:col>')
    expect(after).toContain('<xdr:col>6</xdr:col>')
    expect(after).toContain('<xdr:row>4</xdr:row>')
  })

  it('keeps everything it does not understand, which is the point', () => {
    // A shape or a piece of SmartArt survives this; it would not survive the
    // part being written out again from the model.
    const after = adjustDrawingAnchors(anchor(4, 20), { axis: 'row', at: 0, by: 2 })

    expect(after).toContain('<xdr:rowOff>9525</xdr:rowOff>')
    expect(after).toContain('<xdr:graphicFrame/>')
    expect(after).toContain('<xdr:clientData/>')
  })

  it('flattens rather than removes a drawing whose rows all went', () => {
    // Taking it out would mean taking out the chart part and the relationship
    // behind it, and a row deleted is not somebody asking for that.
    const after = adjustDrawingAnchors(anchor(4, 6), { axis: 'row', at: 4, by: -3 })

    expect(after).toContain(
      '<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row>',
    )
    expect(after).toContain(
      '<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row>',
    )
  })

  it('changes nothing when nothing moved', () => {
    const xml = anchor(4, 20)

    expect(adjustDrawingAnchors(xml, { axis: 'row', at: 0, by: 0 })).toBe(xml)
    expect(adjustDrawingAnchors(xml, { axis: 'row', at: 30, by: 2 })).toBe(xml)
  })
})
