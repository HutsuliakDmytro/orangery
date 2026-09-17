import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { insertPicture, relsPartFor, UnsupportedPictureError } from './insert-picture'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const box = { x: 100000, y: 200000, width: 900000, height: 600000 }

/** Inserts into the first slide of a deck, saves and reopens. */
async function insert(name: string, fileName = 'photo.png') {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  const id = insertPicture(pkg, slide, { fileName, bytes: PNG, transform: box })
  writeSlidePart(pkg, slide)

  const reopened = await readPptxPackage(await saveDeck(pkg))
  return { id, pkg: reopened, deck: readDeck(reopened), slidePath: slide.path }
}

describe('relsPartFor', () => {
  it('finds the rels file of a slide, which has one of its own', () => {
    // Unlike a document, where every relationship hangs off one file.
    expect(relsPartFor('ppt/slides/slide3.xml')).toBe('ppt/slides/_rels/slide3.xml.rels')
  })
})

describe('inserting a picture', () => {
  it('comes back as a picture on the slide', async () => {
    const { deck } = await insert('empty')
    const picture = deck.slides[0]?.shapes[0]

    expect(picture?.kind).toBe('pic')
    expect(picture?.transform).toMatchObject(box)
  })

  it('puts the bytes in the package', async () => {
    const { pkg } = await insert('empty')
    expect(pkg.parts.get('ppt/media/image1.png')?.bytes).toStrictEqual(PNG)
  })

  it("points at them from this slide's own relationships", async () => {
    const { pkg, deck, slidePath } = await insert('empty')
    const picture = deck.slides[0]?.shapes[0]
    const relationships = parseRelationships(getPartText(pkg, relsPartFor(slidePath)) ?? '')

    const id = picture?.picture?.relationshipId ?? ''
    expect(relationships.get(id)?.target).toBe('../media/image1.png')
  })

  it('declares the content type, without which PowerPoint offers to repair', async () => {
    const { pkg } = await insert('empty')
    expect(getPartText(pkg, '[Content_Types].xml')).toContain('image/png')
  })

  it('does not overwrite media a deck already has', async () => {
    const { pkg } = await insert('picture')

    expect(pkg.parts.has('ppt/media/image1.png')).toBe(true)
    expect(pkg.parts.has('ppt/media/image2.png')).toBe(true)
  })

  it('locks the aspect ratio, as PowerPoint does on insert', async () => {
    const { pkg, slidePath } = await insert('empty')
    expect(getPartText(pkg, slidePath)).toContain('noChangeAspect="1"')
  })

  it('carries alt text when it is given some', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    insertPicture(pkg, slide, {
      fileName: 'photo.png',
      bytes: PNG,
      transform: box,
      description: 'A photograph',
    })
    writeSlidePart(pkg, slide)

    const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
    expect(reopened.slides[0]?.shapes[0]?.description).toBe('A photograph')
  })

  it('refuses a file type no deck can hold', async () => {
    await expect(insert('empty', 'drawing.heic')).rejects.toBeInstanceOf(UnsupportedPictureError)
  })
})
