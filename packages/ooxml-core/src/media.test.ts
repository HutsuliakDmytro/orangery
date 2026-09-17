import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { addMedia, ensureContentType, nextMediaName } from './media'
import { getPartText, readPackage } from './package'
import { parseRelationships } from './relationships'
import type { OoxmlPackage } from './package'

/**
 * A package with the three parts that adding media has to keep in step.
 */
async function packageWith(parts: [string, string][]): Promise<OoxmlPackage> {
  const zip = new JSZip()
  for (const [path, content] of parts) zip.file(path, content)
  return readPackage(await zip.generateAsync({ type: 'uint8array' }))
}

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="x">' +
  '<Default Extension="rels" ContentType="application/rels"/>' +
  '<Override PartName="/ppt/presentation.xml" ContentType="application/presentation"/>' +
  '</Types>'

const RELS =
  '<?xml version="1.0"?><Relationships xmlns="y"><Relationship Id="rId1" Type="t" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'

const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

const deck = () =>
  packageWith([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['ppt/presentation.xml', '<p:presentation/>'],
    ['ppt/slides/slide1.xml', '<p:sld/>'],
    ['ppt/slides/_rels/slide1.xml.rels', RELS],
  ])

describe('nextMediaName', () => {
  it('starts at one in a package with no media', async () => {
    expect(nextMediaName(await deck(), 'ppt/media', 'png')).toBe('image1.png')
  })

  it('never reuses a name already taken', async () => {
    const pkg = await packageWith([
      ['[Content_Types].xml', CONTENT_TYPES],
      ['ppt/media/image1.png', 'x'],
      ['ppt/media/image7.jpeg', 'x'],
    ])

    expect(nextMediaName(pkg, 'ppt/media', 'png')).toBe('image8.png')
  })

  it('counts only the directory it was asked about', async () => {
    const pkg = await packageWith([
      ['[Content_Types].xml', CONTENT_TYPES],
      ['word/media/image9.png', 'x'],
    ])

    expect(nextMediaName(pkg, 'ppt/media', 'png')).toBe('image1.png')
  })
})

describe('ensureContentType', () => {
  it('declares an extension that is not there', async () => {
    const pkg = await deck()
    ensureContentType(pkg, 'png', 'image/png')

    expect(getPartText(pkg, '[Content_Types].xml')).toContain('Extension="png"')
  })

  it('does not declare one twice', async () => {
    const pkg = await deck()
    ensureContentType(pkg, 'png', 'image/png')
    ensureContentType(pkg, 'PNG', 'image/png')

    expect(getPartText(pkg, '[Content_Types].xml')?.match(/Extension="png"/giu)).toHaveLength(1)
  })

  it('keeps the defaults before the overrides, as Office writes them', async () => {
    const pkg = await deck()
    ensureContentType(pkg, 'png', 'image/png')
    const text = getPartText(pkg, '[Content_Types].xml') ?? ''

    expect(text.indexOf('Extension="png"')).toBeLessThan(text.indexOf('<Override'))
  })
})

describe('addMedia', () => {
  const request = {
    directory: 'ppt/media',
    relsPart: 'ppt/slides/_rels/slide1.xml.rels',
    relationshipType: IMAGE,
    fileName: 'photo.png',
    contentType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  }

  it('puts the bytes in the package', async () => {
    const pkg = await deck()
    const added = addMedia(pkg, request)

    expect(added.path).toBe('ppt/media/image1.png')
    expect(pkg.parts.get(added.path)?.bytes).toStrictEqual(request.bytes)
  })

  it('writes the target relative to the rels file, not from the root', async () => {
    // A slide's rels sit in ppt/slides/_rels, so its media is `../media/…`.
    const pkg = await deck()
    const added = addMedia(pkg, request)

    const relationships = parseRelationships(getPartText(pkg, request.relsPart) ?? '')
    expect(relationships.get(added.relationshipId)?.target).toBe('../media/image1.png')
  })

  it('keeps the relationships that were already there', async () => {
    const pkg = await deck()
    addMedia(pkg, request)

    const relationships = parseRelationships(getPartText(pkg, request.relsPart) ?? '')
    expect(relationships.size).toBe(2)
    expect(relationships.get('rId1')?.target).toBe('../slideLayouts/slideLayout1.xml')
  })

  it('declares the content type alongside', async () => {
    // A package missing any one of the three makes PowerPoint offer to repair.
    const pkg = await deck()
    addMedia(pkg, request)

    expect(getPartText(pkg, '[Content_Types].xml')).toContain('image/png')
  })

  it('writes a document\'s media without the "../", since its rels sit higher', async () => {
    const pkg = await packageWith([
      ['[Content_Types].xml', CONTENT_TYPES],
      ['word/document.xml', '<w:document/>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="y"/>'],
    ])

    const added = addMedia(pkg, {
      ...request,
      directory: 'word/media',
      relsPart: 'word/_rels/document.xml.rels',
    })
    const relationships = parseRelationships(getPartText(pkg, 'word/_rels/document.xml.rels') ?? '')

    expect(relationships.get(added.relationshipId)?.target).toBe('media/image1.png')
  })
})
