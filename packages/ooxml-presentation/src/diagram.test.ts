import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addRelationship,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, Relationship } from '@orangery/ooxml-core'
import { readSlidePart } from './deck'
import type { SlidePart } from './deck'
import { convertDiagramToShapes, diagramDrawingPart, readDiagramShapes } from './diagram'
import { absoluteTransform } from './group-transform'
import { writeSlidePart } from './save'
import { flatten } from './shape-tree'
import type { Shape } from './shape-tree'
import { readPptxPackage } from './parts'

/**
 * Drawing SmartArt from the picture PowerPoint drew.
 *
 * No fixture has a diagram — python-pptx will not make one — so the parts are
 * added here. What is being tested is small and exact: where the drawing part
 * is found, that `dsp:sp` is read as a shape, and where those shapes land.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')
const DRAWING_RELATIONSHIP = 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing'

/**
 * Two nodes side by side, in the units PowerPoint writes them in: EMU within
 * the frame's own box, starting at nought.
 */
const node = (id: number, x: number, words: string) =>
  `<dsp:sp><dsp:nvSpPr><dsp:cNvPr id="${String(id)}" name="Node ${String(id)}"/>` +
  '<dsp:cNvSpPr/></dsp:nvSpPr>' +
  `<dsp:spPr><a:xfrm><a:off x="${String(x)}" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>` +
  '<a:prstGeom prst="roundRect"/></dsp:spPr>' +
  `<dsp:txBody><a:bodyPr/><a:p><a:r><a:t>${words}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`

const drawingOf = (groupProperties = '<dsp:grpSpPr/>') =>
  '<dsp:drawing xmlns:dsp="dsp" xmlns:a="a"><dsp:spTree><dsp:nvGrpSpPr/>' +
  groupProperties +
  node(2, 0, 'First') +
  node(3, 2000000, 'Second') +
  '</dsp:spTree></dsp:drawing>'

const DRAWING = drawingOf()

const FRAME = {
  transform: {
    x: 1_000_000,
    y: 500_000,
    width: 4_000_000,
    height: 1_000_000,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    child: null,
  },
  dataId: 'rId5',
}

/** Adds a drawing part, named from wherever the caller says. */
async function withDrawing(from: 'slide' | 'data', drawing = DRAWING): Promise<OoxmlPackage> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
  setPartText(pkg, 'ppt/diagrams/drawing1.xml', drawing)
  setPartText(pkg, 'ppt/diagrams/data1.xml', '<dgm:dataModel xmlns:dgm="dgm"/>')

  const slideRels = parseRelationships(getPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels') ?? '')
  slideRels.set('rId5', {
    id: 'rId5',
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
    target: '../diagrams/data1.xml',
    external: false,
  })

  if (from === 'slide') {
    addRelationship(slideRels, DRAWING_RELATIONSHIP, '../diagrams/drawing1.xml')
  } else {
    const dataRels = new Map<string, Relationship>()
    addRelationship(dataRels, DRAWING_RELATIONSHIP, 'drawing1.xml')
    setPartText(pkg, 'ppt/diagrams/_rels/data1.xml.rels', serializeRelationships(dataRels))
  }

  setPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels', serializeRelationships(slideRels))
  return pkg
}

describe('finding the picture PowerPoint drew', () => {
  it('finds it named from the slide', async () => {
    const pkg = await withDrawing('slide')
    expect(diagramDrawingPart(pkg, 'ppt/slides/slide1.xml', 'rId5')).toBe(
      'ppt/diagrams/drawing1.xml',
    )
  })

  it('finds it named from the data part instead', async () => {
    // The two versions that wrote them disagreed about where it goes, and a
    // reader that knew one placement would draw half the decks as empty boxes.
    const pkg = await withDrawing('data')
    expect(diagramDrawingPart(pkg, 'ppt/slides/slide1.xml', 'rId5')).toBe(
      'ppt/diagrams/drawing1.xml',
    )
  })

  it('finds nothing where the diagram was never opened in PowerPoint', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    expect(diagramDrawingPart(pkg, 'ppt/slides/slide1.xml', null)).toBeNull()
  })
})

describe('the shapes of a diagram', () => {
  it('reads `dsp:sp` as the shape it is', async () => {
    const shapes = readDiagramShapes(await withDrawing('slide'), 'ppt/slides/slide1.xml', FRAME)

    expect(shapes).toHaveLength(2)
    expect(shapes[0]?.properties?.geometry?.preset).toBe('roundRect')
    expect(shapes[0]?.text?.paragraphs[0]?.runs[0]?.text).toBe('First')
  })

  it('places them inside the frame', async () => {
    const shapes = readDiagramShapes(await withDrawing('slide'), 'ppt/slides/slide1.xml', FRAME)

    // Half the drawing's width each, so half the frame's width each.
    expect(shapes[0]?.transform).toMatchObject({ x: 1_000_000, width: 2_000_000 })
    expect(shapes[1]?.transform).toMatchObject({ x: 3_000_000, width: 2_000_000 })
  })

  it('gives nothing for a diagram with no picture of itself', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    expect(readDiagramShapes(pkg, 'ppt/slides/slide1.xml', FRAME)).toEqual([])
  })

  it('scales them where the drawing states a space of its own', async () => {
    // Some writers put the whole diagram in a thousand-unit box and let the
    // frame stretch it; the drawing says so with `chOff` and `chExt`.
    const stated =
      '<dsp:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000" cy="500"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="1000000"/></a:xfrm></dsp:grpSpPr>'
    const shapes = readDiagramShapes(
      await withDrawing('slide', drawingOf(stated)),
      'ppt/slides/slide1.xml',
      FRAME,
    )

    expect(shapes[1]?.transform).toMatchObject({ x: 3_000_000, width: 2_000_000 })
  })

  it('gives nothing for a frame with nowhere to be', async () => {
    const pkg = await withDrawing('slide')
    expect(readDiagramShapes(pkg, 'ppt/slides/slide1.xml', { ...FRAME, transform: null })).toEqual(
      [],
    )
  })
})

describe('turning a diagram into shapes', () => {
  /** A slide holding a diagram frame, with the drawing behind it. */
  async function withFrame(): Promise<{ pkg: OoxmlPackage; slide: SlidePart; frame: Shape }> {
    const pkg = await withDrawing('slide')

    const slideText = getPartText(pkg, 'ppt/slides/slide1.xml') ?? ''
    const frame =
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Diagram"/>' +
      '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
      '<p:xfrm><a:off x="1000000" y="500000"/><a:ext cx="4000000" cy="1000000"/></p:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">' +
      '<dgm:relIds xmlns:dgm="dgm" r:dm="rId5"/></a:graphicData></a:graphic></p:graphicFrame>'
    setPartText(
      pkg,
      'ppt/slides/slide1.xml',
      slideText.replace('</p:spTree>', `${frame}</p:spTree>`),
    )

    const slide = readSlidePart(pkg, 'ppt/slides/slide1.xml')
    const found = slide?.shapes.find((one) => one.graphic?.kind === 'diagram')
    if (slide === null || found === undefined) throw new Error('the frame was not added')

    return { pkg, slide, frame: found }
  }

  it('leaves a group of the shapes PowerPoint drew', async () => {
    const { pkg, slide, frame } = await withFrame()
    const id = convertDiagramToShapes(pkg, slide, frame)
    writeSlidePart(pkg, slide)

    const after = readSlidePart(pkg, 'ppt/slides/slide1.xml')
    const group = after?.shapes.find((one) => one.id === id)

    expect(group?.kind).toBe('grpSp')
    expect(flatten(group === undefined ? [] : [group])).toHaveLength(3)
  })

  it('puts the shapes where the diagram had them', async () => {
    const { pkg, slide, frame } = await withFrame()
    const id = convertDiagramToShapes(pkg, slide, frame)
    writeSlidePart(pkg, slide)

    const after = readSlidePart(pkg, 'ppt/slides/slide1.xml')
    const group = after?.shapes.find((one) => one.id === id)
    const members = flatten(group === undefined ? [] : [group]).filter((one) => one.kind === 'sp')

    // Through the group, which does the mapping the frame was doing.
    const first = members[0]
    expect(
      first === undefined || group?.transform == null
        ? null
        : absoluteTransform(first.transform, [group]),
    ).toMatchObject({ x: 1_000_000, width: 2_000_000 })
  })

  it('takes the frame away', async () => {
    const { pkg, slide, frame } = await withFrame()
    convertDiagramToShapes(pkg, slide, frame)
    writeSlidePart(pkg, slide)

    const after = readSlidePart(pkg, 'ppt/slides/slide1.xml')
    expect(after?.shapes.some((one) => one.graphic?.kind === 'diagram')).toBe(false)
  })

  it('gives every shape an id no other shape is using', async () => {
    const { pkg, slide, frame } = await withFrame()
    convertDiagramToShapes(pkg, slide, frame)
    writeSlidePart(pkg, slide)

    const after = readSlidePart(pkg, 'ppt/slides/slide1.xml')
    const ids = flatten(after?.shapes ?? []).map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('takes the diagram’s own parts with it', async () => {
    const { pkg, slide, frame } = await withFrame()
    convertDiagramToShapes(pkg, slide, frame)

    // An orphan in an OPC package is what makes PowerPoint offer to repair it.
    expect([...pkg.parts.keys()].some((path) => path.startsWith('ppt/diagrams/'))).toBe(false)
  })

  it('refuses a diagram with no picture of itself', async () => {
    const { pkg, slide, frame } = await withFrame()
    pkg.parts.delete('ppt/diagrams/drawing1.xml')

    // Nothing to convert it into, and guessing would invent a picture nobody
    // has seen.
    expect(convertDiagramToShapes(pkg, slide, frame)).toBeNull()
  })
})
