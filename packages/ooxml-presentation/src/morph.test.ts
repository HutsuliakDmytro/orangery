import { describe, expect, it } from 'vitest'
import { parseXml } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'
import { creationIdOf, matchShapes, morphOrigins } from './morph'
import { parseShapeTree } from './shape-tree'
import { readTransition } from './transition'

/**
 * Which shape on one slide is which shape on the next.
 *
 * A morph is the claim that two slides show the same objects in different
 * places. Getting the answer wrong does not look like a worse morph — it looks
 * like the wrong things flying across the screen, which is why every one of
 * these is about refusing to guess.
 */

interface Made {
  id: number
  name?: string
  at: [number, number, number, number]
  creation?: string
  text?: string
  preset?: string
}

function slideOf(shapes: readonly Made[]): SlidePart {
  const xml =
    '<p:spTree xmlns:p="p" xmlns:a="a" xmlns:a16="a16"><p:nvGrpSpPr/><p:grpSpPr/>' +
    shapes
      .map(
        (shape) =>
          `<p:sp><p:nvSpPr><p:cNvPr id="${String(shape.id)}" name="${shape.name ?? ''}">` +
          (shape.creation === undefined
            ? ''
            : `<a:extLst><a:ext uri="{FF}"><a16:creationId val="${shape.creation}"/></a:ext></a:extLst>`) +
          '</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
          `<p:spPr><a:xfrm><a:off x="${String(shape.at[0])}" y="${String(shape.at[1])}"/>` +
          `<a:ext cx="${String(shape.at[2])}" cy="${String(shape.at[3])}"/></a:xfrm>` +
          `<a:prstGeom prst="${shape.preset ?? 'rect'}"/></p:spPr>` +
          `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${shape.text ?? ''}</a:t></a:r></a:p></p:txBody></p:sp>`,
      )
      .join('') +
    '</p:spTree>'

  const tree = parseXml(xml)[0]
  if (tree === undefined) throw new Error('bad fixture')

  const root = { 'p:sld': [{ 'p:cSld': [tree] }] }
  return { path: 'ppt/slides/slide1.xml', root, tree, shapes: parseShapeTree(tree) }
}

describe('a shape’s creation id', () => {
  it('is read from the extension PowerPoint writes it in', () => {
    const slide = slideOf([{ id: 2, at: [0, 0, 100, 100], creation: '{ABC}' }])
    expect(creationIdOf(slide.shapes[0] as never)).toBe('{ABC}')
  })

  it('is null on a shape that carries none', () => {
    const slide = slideOf([{ id: 2, at: [0, 0, 100, 100] }])
    expect(creationIdOf(slide.shapes[0] as never)).toBeNull()
  })
})

describe('matching the shapes of two slides', () => {
  it('pairs by creation id first, whatever else differs', () => {
    const from = slideOf([{ id: 2, name: 'Box', at: [0, 0, 100, 100], creation: '{A}' }])
    const to = slideOf([{ id: 9, name: 'Renamed', at: [500, 0, 200, 200], creation: '{A}' }])

    const pairs = matchShapes(from, to)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.to.id).toBe(9)
  })

  it('falls back to the name, which people rarely change', () => {
    const from = slideOf([{ id: 2, name: 'Logo', at: [0, 0, 100, 100] }])
    const to = slideOf([{ id: 9, name: 'Logo', at: [400, 400, 100, 100] }])

    expect(matchShapes(from, to)).toHaveLength(1)
  })

  it('falls back to the same kind holding the same words', () => {
    // Which is what matches a title to a title.
    const from = slideOf([{ id: 2, at: [0, 0, 900, 100], text: 'Results' }])
    const to = slideOf([{ id: 9, at: [0, 400, 900, 100], text: 'Results' }])

    expect(matchShapes(from, to)).toHaveLength(1)
  })

  it('refuses to pair when two shapes answer to the same thing', () => {
    // Two boxes called "Rectangle 3" say nothing about which is which, and
    // picking one is how a morph sends the wrong box across the screen.
    const from = slideOf([
      { id: 2, name: 'Rectangle 3', at: [0, 0, 100, 100] },
      { id: 3, name: 'Rectangle 3', at: [200, 0, 100, 100] },
    ])
    const to = slideOf([{ id: 9, name: 'Rectangle 3', at: [400, 0, 100, 100] }])

    expect(matchShapes(from, to)).toEqual([])
  })

  it('claims each shape once', () => {
    const from = slideOf([{ id: 2, name: 'Box', at: [0, 0, 100, 100], creation: '{A}' }])
    const to = slideOf([
      { id: 9, name: 'Box', at: [400, 0, 100, 100], creation: '{A}' },
      { id: 10, name: 'Box', at: [800, 0, 100, 100] },
    ])

    // The creation id won; the name must not pair the same shape again.
    const pairs = matchShapes(from, to)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.to.id).toBe(9)
  })

  it('leaves a shape nothing matches alone', () => {
    const from = slideOf([{ id: 2, name: 'Gone', at: [0, 0, 100, 100], text: 'Before' }])
    const to = slideOf([{ id: 9, name: 'New', at: [0, 0, 100, 100], preset: 'ellipse' }])

    expect(matchShapes(from, to)).toEqual([])
  })

  it('pairs the only shape of its kind on each side', () => {
    // One rectangle here and one there is the classic morph, and refusing it
    // because nobody named them would be refusing the common case.
    const from = slideOf([{ id: 2, at: [0, 0, 100, 100] }])
    const to = slideOf([{ id: 9, at: [400, 0, 300, 300] }])

    expect(matchShapes(from, to)).toHaveLength(1)
  })
})

describe('where a shape comes from', () => {
  it('gives the old box of every shape that moved', () => {
    const from = slideOf([{ id: 2, name: 'Box', at: [0, 0, 100, 100] }])
    const to = slideOf([{ id: 9, name: 'Box', at: [400, 300, 200, 200] }])

    expect(morphOrigins(from, to).get(9)).toMatchObject({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('says nothing about a shape that did not move', () => {
    // Animating it from itself would be a frame of work for no picture.
    const from = slideOf([{ id: 2, name: 'Box', at: [10, 10, 100, 100] }])
    const to = slideOf([{ id: 9, name: 'Box', at: [10, 10, 100, 100] }])

    expect(morphOrigins(from, to).size).toBe(0)
  })
})

describe('reading a morph transition', () => {
  const withTransition = (xml: string): SlidePart => {
    const root = parseXml(`<p:sld xmlns:p="p" xmlns:mc="mc" xmlns:p159="p159">${xml}</p:sld>`)[0]
    if (root === undefined) throw new Error('bad fixture')
    return { path: 'ppt/slides/slide1.xml', root, tree: root, shapes: [] }
  }

  it('is recognised whatever prefix the version that wrote it used', () => {
    const slide = withTransition(
      '<mc:AlternateContent><mc:Choice><p:transition p14:dur="800" ' +
        'xmlns:p14="p14"><p159:morph option="byObject"/></p:transition></mc:Choice>' +
        '</mc:AlternateContent>',
    )

    expect(readTransition(slide)).toMatchObject({ kind: 'morph', duration: 800 })
  })

  it('is not a fade, which is what everything unreadable becomes', () => {
    const slide = withTransition('<p:transition><p:checker/></p:transition>')
    expect(readTransition(slide)?.kind).toBe('fade')
  })
})
