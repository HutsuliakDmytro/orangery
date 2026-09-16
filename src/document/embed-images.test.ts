import { describe, expect, it } from 'vitest'
import { createNewDocx } from './docx-file'
import { decodeDataUrl, embedImagesInto } from './embed-images'
import { parseSection } from '../ooxml/section'
import type { ProseMirrorNodeJson } from '../ooxml/parse-document'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const section = parseSection(null)

function docWith(image: Record<string, unknown>): ProseMirrorNodeJson {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'image', attrs: image }] }],
  }
}

describe('decodeDataUrl', () => {
  it('reads the bytes and the extension', () => {
    const decoded = decodeDataUrl(PNG)
    expect(decoded?.extension).toBe('png')
    // The PNG signature, so the bytes really were decoded.
    expect([...(decoded?.bytes.slice(0, 4) ?? [])]).toEqual([137, 80, 78, 71])
  })

  it('names a JPEG the way Word does', () => {
    expect(decodeDataUrl('data:image/jpeg;base64,/9j/')?.extension).toBe('jpg')
    expect(decodeDataUrl('data:image/svg+xml;base64,PHN2Zy8+')?.extension).toBe('svg')
  })

  it('returns nothing for an address that is not a data URL', () => {
    expect(decodeDataUrl('https://example.com/a.png')).toBeNull()
    expect(decodeDataUrl('Pictures/a.png')).toBeNull()
  })

  it('returns nothing for a data URL whose payload is damaged', () => {
    expect(decodeDataUrl('data:image/png;base64,!!!!')).toBeNull()
  })
})

describe('embedImagesInto', () => {
  it('adds the bytes to the package and points the node at them', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc, warnings } = await embedImagesInto(pkg, docWith({ src: PNG, width: 72, height: 36 }), {
      section,
    })

    const image = doc.content?.[0]?.content?.[0]
    expect(image?.attrs?.['relationshipId']).toMatch(/^rId\d+$/u)
    expect(pkg.parts.has('word/media/image1.png')).toBe(true)
    expect(warnings).toHaveLength(0)
  })

  it('clears markup preserved from the format the document came from', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc } = await embedImagesInto(
      pkg,
      docWith({ src: PNG, width: 72, height: 36, frame: '<draw:frame/>', href: 'Pictures/a.png' }),
      { section },
    )

    const attrs = doc.content?.[0]?.content?.[0]?.attrs
    // Left in place, the serializer would write OpenDocument markup into
    // `document.xml`.
    expect(attrs?.['frame']).toBeNull()
    expect(attrs?.['href']).toBeNull()
    expect(attrs?.['drawing']).toBeNull()
  })

  it('measures a picture that arrived without a size', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc } = await embedImagesInto(pkg, docWith({ src: PNG }), {
      section,
      measure: () => Promise.resolve({ width: 100, height: 50 }),
    })

    const attrs = doc.content?.[0]?.content?.[0]?.attrs
    expect(attrs?.['width']).toBe(100)
    expect(attrs?.['height']).toBe(50)
  })

  it('scales a picture that is wider than the text column', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc } = await embedImagesInto(pkg, docWith({ src: PNG, width: 2000, height: 1000 }), {
      section,
    })

    const width = doc.content?.[0]?.content?.[0]?.attrs?.['width']
    expect(typeof width === 'number' && width < 2000).toBe(true)
  })

  it('drops a picture it cannot carry and says which', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc, warnings } = await embedImagesInto(
      pkg,
      docWith({ src: 'https://example.com/a.png' }),
      { section },
    )

    expect(doc.content?.[0]?.content).toHaveLength(0)
    expect(warnings[0]?.tag).toBe('image')
    expect(warnings[0]?.message).toMatch(/outside the document/)
  })

  it('numbers several pictures separately', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc } = await embedImagesInto(
      pkg,
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, width: 10, height: 10 } }] },
          { type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, width: 10, height: 10 } }] },
        ],
      },
      { section },
    )

    const first = doc.content?.[0]?.content?.[0]?.attrs
    const second = doc.content?.[1]?.content?.[0]?.attrs

    expect(first?.['relationshipId']).not.toBe(second?.['relationshipId'])
    expect(pkg.parts.has('word/media/image2.png')).toBe(true)
  })

  it('reaches pictures nested inside a table', async () => {
    const pkg = (await createNewDocx()).pkg
    const { doc } = await embedImagesInto(
      pkg,
      {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'image', attrs: { src: PNG, width: 10, height: 10 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { section },
    )

    const cell = doc.content?.[0]?.content?.[0]?.content?.[0]
    expect(cell?.content?.[0]?.content?.[0]?.attrs?.['relationshipId']).toMatch(/^rId\d+$/u)
  })
})
