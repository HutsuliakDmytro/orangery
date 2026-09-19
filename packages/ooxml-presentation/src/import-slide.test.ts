import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships, setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import type { Deck } from './deck'
import { importSlide } from './import-slide'
import { readPptxPackage } from './parts'
import { readPresentation } from './presentation'
import { saveDeck } from './save'
import { flatten } from './shape-tree'

/**
 * A slide arriving from a package this one has never seen.
 *
 * Every assertion goes through a save and a reopen. A slide that looks right in
 * memory and names a part that was never copied is exactly the file PowerPoint
 * offers to repair, and reading the package back is the only way to find out.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = (name: string): Promise<OoxmlPackage> =>
  readFile(join(FIXTURES, `${name}.pptx`)).then(readPptxPackage)

/** The package as it would be opened from disk after being saved. */
const reopen = async (pkg: OoxmlPackage): Promise<OoxmlPackage> =>
  readPptxPackage(await saveDeck(pkg))

const wordsOn = (deck: Deck, index: number): string =>
  flatten(deck.slides[index]?.shapes ?? [])
    .map((shape) => (shape.text === null ? '' : textOfBody(shape.text)))
    .join(' ')

/** Imports the first slide of one fixture into another, and reads it back. */
async function imported(
  into: string,
  from: string,
  at = 0,
  slide = 0,
): Promise<{ pkg: OoxmlPackage; deck: Deck; path: string }> {
  const destination = await load(into)
  const source = await load(from)

  const sourcePath = readPresentation(source).slides[slide]?.path
  if (sourcePath === undefined) throw new Error('fixture has no slides')

  const added = importSlide(destination, source, sourcePath, at)
  if (added === null) throw new Error('nothing was imported')

  const pkg = await reopen(destination)
  return { pkg, deck: readDeck(pkg), path: added.path }
}

describe('bringing a slide across', () => {
  it('puts it where it was asked for, with what was on it', async () => {
    const { deck } = await imported('empty', 'placeholders')

    expect(deck.slides).toHaveLength(2)
    expect(wordsOn(deck, 0)).toContain('Placeholder inheritance')
  })

  it('lands after the slides it was asked to follow', async () => {
    const { deck } = await imported('many-slides', 'placeholders', 3)

    expect(deck.slides).toHaveLength(9)
    expect(wordsOn(deck, 3)).toContain('Placeholder inheritance')
  })

  it('does not land on a part this deck already has', async () => {
    const { pkg } = await imported('many-slides', 'placeholders')

    // Eight slides plus the one that arrived, none of them overwritten.
    const slides = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/slides/slide'))
    expect(slides).toHaveLength(9)
    expect(readDeck(pkg).slides).toHaveLength(9)
  })

  it('is declared in the content types, or nothing would open it', async () => {
    const { pkg, path } = await imported('empty', 'placeholders')

    expect(getPartText(pkg, '[Content_Types].xml')).toContain(`/${path}`)
  })
})

describe('the layout it was built on', () => {
  it('is this deck’s where this deck has the same one', async () => {
    const mine = readPresentation(await load('empty')).masters[0]?.layouts ?? []
    const { pkg, deck } = await imported('empty', 'placeholders')

    // Nothing new: the slide is dressed in a layout this deck already had, and
    // it is the one with the same name rather than whichever came first.
    expect(readPresentation(pkg).masters[0]?.layouts).toHaveLength(mine.length)
    expect(mine).toContain(deck.slides[0]?.layout)
    expect(getPartText(pkg, deck.slides[0]?.layout ?? '')).toContain('name="Title and Content"')
  })

  it('comes across when this deck has nothing like it', async () => {
    const destination = await load('empty')
    const source = await load('placeholders')

    // A layout of their own: no name this deck knows and no kind either, which
    // is what a deck built on somebody's template looks like from here.
    const map = readPresentation(source)
    const layoutPath = map.slides[0]?.layout ?? null
    if (layoutPath === null) throw new Error('fixture slide has no layout')
    setPartText(
      source,
      layoutPath,
      (getPartText(source, layoutPath) ?? '')
        .replace(/ type="[^"]*"/u, '')
        .replace(/<p:cSld name="[^"]*"/u, '<p:cSld name="Reviewer’s own"'),
    )

    const sourcePath = map.slides[0]?.path ?? ''
    expect(importSlide(destination, source, sourcePath, 0)).not.toBeNull()

    const pkg = await reopen(destination)
    const master = readPresentation(pkg).masters[0]
    const layouts = master?.layouts ?? []

    // Registered with the master, which is the only way PowerPoint offers it.
    expect(layouts).toHaveLength(12)
    expect(readDeck(pkg).slides[0]?.layout).toBe(layouts.at(-1))
  })

  it('is pointed at this deck’s master, so the slide wears this deck’s theme', async () => {
    const destination = await load('empty')
    const source = await load('placeholders')

    const map = readPresentation(source)
    const layoutPath = map.slides[0]?.layout ?? ''
    setPartText(
      source,
      layoutPath,
      (getPartText(source, layoutPath) ?? '')
        .replace(/ type="[^"]*"/u, '')
        .replace(/<p:cSld name="[^"]*"/u, '<p:cSld name="Reviewer’s own"'),
    )

    importSlide(destination, source, map.slides[0]?.path ?? '', 0)
    const pkg = await reopen(destination)

    const master = readPresentation(pkg).masters[0]?.path
    const arrived = readPresentation(pkg).masters[0]?.layouts.at(-1) ?? ''
    const relationships = parseRelationships(
      getPartText(pkg, arrived.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels') ??
        '',
    )
    const toMaster = [...relationships.values()].find((one) => one.type.endsWith('/slideMaster'))

    expect(readPresentation(pkg).masters).toHaveLength(1)
    expect(toMaster?.target.split('/').pop()).toBe(master?.split('/').pop())
  })
})

describe('what the slide points at', () => {
  it('brings a picture’s bytes, rather than sharing a file this deck cannot see', async () => {
    const { pkg } = await imported('empty', 'picture')

    const media = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/media/'))
    expect(media).toHaveLength(1)
    // The extension has to be declared too, or the picture is a part nothing
    // knows how to read.
    expect(getPartText(pkg, '[Content_Types].xml')).toContain('Extension="png"')
  })

  it('brings a chart whole, workbook and all', async () => {
    const { pkg } = await imported('empty', 'charts')

    const charts = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/charts/chart'))
    const books = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/embeddings/'))

    expect(charts.length).toBeGreaterThan(0)
    expect(books.length).toBeGreaterThan(0)
  })

  it('brings the notes page, pointed back at where the slide landed', async () => {
    const { pkg, path } = await imported('empty', 'notes')

    const notes = readPresentation(pkg).slides[0]?.notes
    expect(notes).not.toBeNull()

    const relationships = parseRelationships(
      getPartText(pkg, `ppt/notesSlides/_rels/${notes?.split('/').pop() ?? ''}.rels`) ?? '',
    )
    const toSlide = [...relationships.values()].find((one) => one.type.endsWith('/slide'))

    expect(toSlide?.target.split('/').pop()).toBe(path.split('/').pop())
    // A deck with no notes of its own has no notes master either; theirs comes
    // with the page, because a page without one is a part PowerPoint refuses.
    expect(readPresentation(pkg).notesMaster).not.toBeNull()
  })

  it('keeps a link that points out of the package', async () => {
    const { pkg } = await imported('empty', 'links')

    const relationships = parseRelationships(
      getPartText(pkg, 'ppt/slides/_rels/slide2.xml.rels') ?? '',
    )
    const external = [...relationships.values()].find((one) => one.external)

    expect(external?.target).toBe('https://orangery.example/deck')
  })

  it('empties a link to a slide that did not come with it', async () => {
    const { pkg } = await imported('empty', 'links')

    const relationships = parseRelationships(
      getPartText(pkg, 'ppt/slides/_rels/slide2.xml.rels') ?? '',
    )
    // Their deck's third slide is not here, so nothing may name it.
    expect([...relationships.values()].some((one) => one.type.endsWith('/slide'))).toBe(false)
    expect(getPartText(pkg, 'ppt/slides/slide2.xml')).toContain('r:id=""')
  })

  it('points a link at this deck’s copy of the slide it meant', async () => {
    // Both decks are the same file, so the slide the link names is in both —
    // which is the case a review is: a copy of your own deck, sent back.
    const destination = await load('links')
    const source = await load('links')

    const sourcePath = readPresentation(source).slides[0]?.path ?? ''
    const added = importSlide(destination, source, sourcePath, 0)
    const pkg = await reopen(destination)

    const relationships = parseRelationships(
      getPartText(pkg, `ppt/slides/_rels/${added?.path.split('/').pop() ?? ''}.rels`) ?? '',
    )
    const toSlide = [...relationships.values()].find((one) => one.type.endsWith('/slide'))

    expect(toSlide?.target).toBe('slide3.xml')
  })
})

describe('what it refuses', () => {
  it('says so when the slide is not in the other package', async () => {
    const destination = await load('empty')
    const source = await load('empty')

    expect(importSlide(destination, source, 'ppt/slides/slide9.xml', 0)).toBeNull()
  })
})
