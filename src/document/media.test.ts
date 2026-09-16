import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES_PART, getPartText, readPackage } from '../ooxml/package'
import { parseRelationships } from '../ooxml/relationships'
import {
  addImage,
  DOCUMENT_RELS_PART,
  ensureContentType,
  mediaDataUrl,
  nextMediaName,
  UnsupportedImageError,
} from './media'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

async function fixture(name = 'plain-paragraphs') {
  return readPackage(await readFile(join(FIXTURES, `${name}.docx`)))
}

/** A one-pixel PNG, enough to exercise the package plumbing. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

describe('nextMediaName', () => {
  it('starts at one in a package with no media', async () => {
    expect(nextMediaName(await fixture(), 'png')).toBe('image1.png')
  })

  it('continues past the highest existing image', async () => {
    const pkg = await fixture()
    pkg.parts.set('word/media/image4.jpeg', {
      path: 'word/media/image4.jpeg',
      bytes: new Uint8Array(),
      date: new Date(),
    })

    expect(nextMediaName(pkg, 'png')).toBe('image5.png')
  })
})

describe('addImage', () => {
  it('stores the bytes under word/media', async () => {
    const pkg = await fixture()
    const added = addImage(pkg, 'photo.png', PNG)

    expect(added.path).toBe('word/media/image1.png')
    expect(pkg.parts.get(added.path)?.bytes).toStrictEqual(PNG)
  })

  it('adds a relationship pointing at the media file', async () => {
    const pkg = await fixture()
    const added = addImage(pkg, 'photo.png', PNG)

    const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
    expect(relationships.get(added.relationshipId)?.target).toBe('media/image1.png')
  })

  it('declares the extension in [Content_Types].xml', async () => {
    const pkg = await fixture()
    addImage(pkg, 'photo.png', PNG)

    expect(getPartText(pkg, CONTENT_TYPES_PART)).toContain('Extension="png"')
  })

  it('does not duplicate an extension already declared', async () => {
    const pkg = await fixture()
    addImage(pkg, 'a.png', PNG)
    addImage(pkg, 'b.png', PNG)

    const declarations = (getPartText(pkg, CONTENT_TYPES_PART) ?? '').match(/Extension="png"/gu)
    expect(declarations).toHaveLength(1)
  })

  it('gives each image its own relationship', async () => {
    const pkg = await fixture()
    const first = addImage(pkg, 'a.png', PNG)
    const second = addImage(pkg, 'b.png', PNG)

    expect(second.relationshipId).not.toBe(first.relationshipId)
    expect(second.path).not.toBe(first.path)
  })

  it('rejects a format Word cannot embed, by name', async () => {
    const pkg = await fixture()
    expect(() => addImage(pkg, 'photo.heic', PNG)).toThrow(UnsupportedImageError)
    expect(() => addImage(pkg, 'photo.heic', PNG)).toThrow(/\.heic/u)
  })

  it('leaves the package untouched when the format is rejected', async () => {
    const pkg = await fixture()
    const before = pkg.parts.size

    expect(() => addImage(pkg, 'photo.heic', PNG)).toThrow()
    expect(pkg.parts.size).toBe(before)
  })
})

describe('ensureContentType', () => {
  it('puts Default entries before Override entries, as the schema requires', async () => {
    const pkg = await fixture()
    ensureContentType(pkg, 'png', 'image/png')

    const xml = getPartText(pkg, CONTENT_TYPES_PART) ?? ''
    const lastDefault = xml.lastIndexOf('<Default')
    const firstOverride = xml.indexOf('<Override')

    expect(lastDefault).toBeLessThan(firstOverride)
  })
})

describe('mediaDataUrl', () => {
  it('produces a data URL the webview can display', async () => {
    const pkg = await fixture()
    const added = addImage(pkg, 'photo.png', PNG)

    expect(mediaDataUrl(pkg, added.path)?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('returns null for a part that is not there', async () => {
    expect(mediaDataUrl(await fixture(), 'word/media/nope.png')).toBeNull()
  })

  it('returns null for a part with no known image type', async () => {
    const pkg = await fixture()
    pkg.parts.set('word/media/thing.bin', {
      path: 'word/media/thing.bin',
      bytes: PNG,
      date: new Date(),
    })

    expect(mediaDataUrl(pkg, 'word/media/thing.bin')).toBeNull()
  })
})
