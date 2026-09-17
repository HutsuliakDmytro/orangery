import { findDescendant, parseXml, serializeNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { blipRelationshipId, pictureGraphic } from './picture'
import { pointsToEmu } from './units'

const node = (xml: string) => parseXml(xml)[0]

describe('blipRelationshipId', () => {
  it('reads the id through the wrappers a graphic puts around it', () => {
    const graphic = node(
      '<a:graphic><a:graphicData><pic:pic><pic:blipFill>' +
        '<a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>',
    )

    expect(graphic === undefined ? null : blipRelationshipId(graphic)).toBe('rId7')
  })

  it('returns null when there is no picture in it', () => {
    const shape = node('<p:sp><p:spPr/></p:sp>')
    expect(shape === undefined ? 'x' : blipRelationshipId(shape)).toBeNull()
  })

  it('returns null for a blip that links rather than embeds', () => {
    // `r:link` points at an external file, which is not a part of the package.
    const graphic = node('<a:graphic><a:blip r:link="rId9"/></a:graphic>')
    expect(graphic === undefined ? 'x' : blipRelationshipId(graphic)).toBeNull()
  })
})

describe('pictureGraphic', () => {
  const built = pictureGraphic({
    relationshipId: 'rId4',
    id: 3,
    name: 'Picture 3',
    width: pointsToEmu(144),
    height: pointsToEmu(72),
  })

  it('embeds the relationship it was given', () => {
    expect(blipRelationshipId(built)).toBe('rId4')
  })

  it('writes the extent in EMU', () => {
    const extent = findDescendant(built, 'a:ext')
    expect(serializeNode(extent ?? {})).toContain(`cx="${String(pointsToEmu(144))}"`)
  })

  it('declares the namespaces, since the graphic can be dropped into any host', () => {
    const xml = serializeNode(built)
    expect(xml).toContain('xmlns:a=')
    expect(xml).toContain('xmlns:pic=')
    expect(xml).toContain('xmlns:r=')
  })

  it('names the shape, which is what the selection pane shows', () => {
    expect(serializeNode(built)).toContain('name="Picture 3"')
  })
})
