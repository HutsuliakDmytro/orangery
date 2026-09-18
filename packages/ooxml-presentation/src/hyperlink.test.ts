import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck } from './deck'
import { resolveHyperlink } from './hyperlink'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'
import { flatten } from './shape-tree'
import type { Deck } from './deck'

/** Where a click on a link goes. */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

async function opened(name: string) {
  const pkg = await load(name)
  return { pkg, deck: readDeck(pkg) }
}

/** The shape on a slide with a name, so a test says which one it means. */
const shapeNamed = (deck: Deck, slide: number, text: string) =>
  flatten(deck.slides[slide]?.shapes ?? []).find((shape) => shape.name.includes(text))

describe('a link to the web', () => {
  it('resolves to the address as written', async () => {
    const { pkg, deck } = await opened('links')
    const box = shapeNamed(deck, 0, 'TextBox')
    const link = box?.text?.paragraphs[0]?.runs[0]?.properties?.hyperlink ?? null

    expect(link).not.toBeNull()
    expect(
      resolveHyperlink(pkg, deck, 'ppt/slides/slide1.xml', {
        relationshipId: link,
        action: null,
      }),
    ).toEqual({ kind: 'url', url: 'https://orangery.example/deck' })
  })
})

describe('a link to a slide', () => {
  it('resolves to where that slide is in the deck', async () => {
    const { pkg, deck } = await opened('links')
    const button = shapeNamed(deck, 0, 'Rounded')

    expect(resolveHyperlink(pkg, deck, 'ppt/slides/slide1.xml', button?.link ?? null)).toEqual({
      kind: 'slide',
      index: 2,
    })
  })

  it('reads the link off the shape rather than off its text', async () => {
    const { deck } = await opened('links')
    const button = shapeNamed(deck, 0, 'Rounded')

    expect(button?.link?.relationshipId).not.toBeNull()
    expect(button?.link?.action).toBe('ppaction://hlinksldjump')
  })
})

describe('a jump with nothing to point at', () => {
  it('resolves to the movement it names', async () => {
    const { pkg, deck } = await opened('links')
    const button = shapeNamed(deck, 1, 'Rounded')

    expect(resolveHyperlink(pkg, deck, 'ppt/slides/slide2.xml', button?.link ?? null)).toEqual({
      kind: 'jump',
      jump: 'next',
    })
  })

  it('knows the other four', async () => {
    const { pkg, deck } = await opened('links')
    const jump = (name: string) =>
      resolveHyperlink(pkg, deck, 'ppt/slides/slide1.xml', {
        relationshipId: null,
        action: `ppaction://hlinkshowjump?jump=${name}`,
      })

    expect(jump('firstslide')).toEqual({ kind: 'jump', jump: 'first' })
    expect(jump('lastslide')).toEqual({ kind: 'jump', jump: 'last' })
    expect(jump('previousslide')).toEqual({ kind: 'jump', jump: 'previous' })
    expect(jump('endshow')).toEqual({ kind: 'jump', jump: 'end' })
  })
})

describe('what is not a link', () => {
  it('says nothing about a shape with none', async () => {
    const { pkg, deck } = await opened('links')
    const title = shapeNamed(deck, 2, 'Title')

    expect(title?.link).toBeNull()
    expect(resolveHyperlink(pkg, deck, 'ppt/slides/slide3.xml', null)).toBeNull()
  })

  it('leaves a video alone, which uses the same element to say it is a video', async () => {
    const { pkg, deck } = await opened('media')
    const film = flatten(deck.slides[0]?.shapes ?? []).find((shape) => shape.media !== null)

    expect(film?.link?.action).toBe('ppaction://media')
    expect(resolveHyperlink(pkg, deck, 'ppt/slides/slide1.xml', film?.link ?? null)).toBeNull()
  })

  it('says nothing for an action it does not know', async () => {
    const { pkg, deck } = await opened('links')

    expect(
      resolveHyperlink(pkg, deck, 'ppt/slides/slide1.xml', {
        relationshipId: null,
        action: 'ppaction://program',
      }),
    ).toBeNull()
  })

  it('says nothing for a relationship that is not there', async () => {
    const { pkg, deck } = await opened('links')

    expect(
      resolveHyperlink(pkg, deck, 'ppt/slides/slide1.xml', {
        relationshipId: 'rId99',
        action: null,
      }),
    ).toBeNull()
  })
})

describe('what the file keeps', () => {
  it('writes the deck back byte for byte', async () => {
    const original = await load('links')
    const reopened = await readPptxPackage(await saveDeck(original))

    for (const [path, part] of original.parts) {
      expect(reopened.parts.get(path)?.bytes, path).toStrictEqual(part.bytes)
    }
  })
})
