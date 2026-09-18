import { describe, expect, it } from 'vitest'
import { getPartText, writePackage } from '@orangery/ooxml-core'
import { createDeck } from './create-deck'
import { readDeck } from './deck'
import { addSlide } from './add-slide'
import { inheritanceChain } from './placeholders'
import { readThemes } from './theme-context'
import { flatten } from './shape-tree'
import { PRESENTATION_PART, readPptxPackage } from './parts'

/**
 * The deck a new presentation starts from.
 *
 * Everything here asks the same question from a different side: is what we made
 * a deck, by the standards of the code that has to read it back. A package that
 * only PowerPoint could judge would be a package nobody could change safely.
 */

describe('a new deck', () => {
  it('is a package our own reader accepts', async () => {
    const pkg = await readPptxPackage(await createDeck())
    expect(getPartText(pkg, PRESENTATION_PART)).toBeDefined()
  })

  it('opens with one slide on it', async () => {
    const deck = readDeck(await readPptxPackage(await createDeck()))
    expect(deck.slides).toHaveLength(1)
  })

  it('is widescreen, like every deck made this decade', async () => {
    const deck = readDeck(await readPptxPackage(await createDeck()))
    expect(deck.slideSize).toEqual({ width: 12192000, height: 6858000 })
  })

  it('carries a master and the layouts it offers', async () => {
    const deck = readDeck(await readPptxPackage(await createDeck()))

    expect(deck.masters.size).toBe(1)
    expect(deck.layouts.size).toBe(6)
  })

  it('builds the first slide on the title layout', async () => {
    const deck = readDeck(await readPptxPackage(await createDeck()))
    expect(deck.slides[0]?.layout).toBe('ppt/slideLayouts/slideLayout1.xml')
  })

  it('gives the slide placeholders that resolve all the way to the master', async () => {
    const pkg = await readPptxPackage(await createDeck())
    const deck = readDeck(pkg)

    const slide = deck.slides[0]
    const title = slide === undefined ? undefined : flatten(slide.shapes)[0]
    if (slide === undefined || title === undefined) throw new Error('the slide came out empty')

    // Three rungs: the shape on the slide, the layout's placeholder of the same
    // kind, and the master's. A chain that stops short is a title that ignores
    // the master, which is the bug this deck exists to not have.
    expect(inheritanceChain(deck, slide, title)).toHaveLength(3)
  })

  it('is painted by a theme the gallery knows', async () => {
    const pkg = await readPptxPackage(await createDeck('Orangery'))
    const deck = readDeck(pkg)
    const theme = [...readThemes(pkg, deck).values()][0]

    // The gallery's orange, which is how we know the theme was applied rather
    // than left as the bare scheme it was built from.
    expect(theme?.colors.get('accent1')?.source).toEqual({ kind: 'srgb', hex: '#FF7A00' })
  })

  it('can be given any theme in the gallery', async () => {
    const pkg = await readPptxPackage(await createDeck('Paper'))
    const deck = readDeck(pkg)
    const theme = [...readThemes(pkg, deck).values()][0]

    expect(theme?.colors.get('accent1')?.source).toEqual({ kind: 'srgb', hex: '#525252' })
  })

  it('takes a second slide the same way any deck does', async () => {
    const pkg = await readPptxPackage(await createDeck())
    const deck = readDeck(pkg)
    const layout = deck.layouts.get('ppt/slideLayouts/slideLayout2.xml')
    if (layout === undefined) throw new Error('no content layout')

    addSlide(pkg, deck, layout, 0)

    expect(readDeck(pkg).slides).toHaveLength(2)
  })

  it('survives being written and read back unchanged', async () => {
    const pkg = await readPptxPackage(await createDeck())
    const again = await readPptxPackage(await writePackage(pkg))

    const before = [...pkg.parts.keys()].sort()
    const after = [...again.parts.keys()].sort()
    expect(after).toEqual(before)
    for (const path of before) {
      expect(getPartText(again, path)).toBe(getPartText(pkg, path))
    }
  })

  it('declares a content type for every part that needs one', async () => {
    const pkg = await readPptxPackage(await createDeck())
    const types = getPartText(pkg, '[Content_Types].xml') ?? ''

    // A part PowerPoint cannot find a type for is the file it offers to repair.
    const undeclared = [...pkg.parts.keys()].filter(
      (path) => !path.endsWith('.rels') && path !== '[Content_Types].xml',
    )
    for (const path of undeclared) {
      expect(types).toContain(`PartName="/${path}"`)
    }
  })
})
