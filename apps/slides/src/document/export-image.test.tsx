import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck, readPptxPackage, readThemes } from '@orangery/ooxml-presentation'
import { pictureName, slideSvg } from './export-image'

/** A slide as a picture. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function open(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)

  return { pkg, deck, themes: readThemes(pkg, deck) }
}

const svgOf = async (name: string, index = 0) => {
  const { pkg, deck, themes } = await open(name)
  const slide = deck.slides[index]
  if (slide === undefined) throw new Error('fixture changed')

  return slideSvg(deck, slide, themes, pkg)
}

describe('the markup', () => {
  it('is an SVG document that stands on its own', async () => {
    const markup = await svgOf('shapes')

    expect(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('states the slide size, so a viewer knows how large it is', async () => {
    const markup = await svgOf('sixteen-by-nine')

    expect(markup).toContain('width="12192000"')
    expect(markup).toContain('height="6858000"')
  })

  it('keeps the coordinate space the slide is drawn in', async () => {
    expect(await svgOf('shapes')).toContain('viewBox="0 0 9144000 6858000"')
  })

  it('carries the text of the slide', async () => {
    expect(await svgOf('shapes')).toContain('Rectangle')
  })

  it('carries a picture as bytes rather than as a path', async () => {
    // A file that pointed at the package would be a file that shows nothing.
    const markup = await svgOf('picture')

    expect(markup).toContain('data:image/png;base64,')
    expect(markup).not.toContain('ppt/media')
  })

  it('exports the slide asked for, not the first one', async () => {
    expect(await svgOf('many-slides', 4)).toContain('Slide 5')
  })

  it('leaves out what the editor draws over it', async () => {
    // No selection, no handles: what is exported is the slide.
    const markup = await svgOf('shapes')
    expect(markup).not.toContain('data-testid="handle"')
  })

  it('draws nothing the file hides', async () => {
    const markup = await svgOf('animations', 1)

    expect(markup).toContain('Shown')
    expect(markup).not.toContain('Not shown')
  })
})

describe('naming the files', () => {
  it('numbers from one, as a person counts slides', () => {
    expect(pictureName('Deck.pptx', 0, 9, 'png')).toBe('Deck-1.png')
  })

  it('pads so a directory sorts the way the deck runs', () => {
    expect(pictureName('Deck.pptx', 0, 10, 'png')).toBe('Deck-01.png')
    expect(pictureName('Deck.pptx', 9, 10, 'png')).toBe('Deck-10.png')
    expect(pictureName('Deck.pptx', 0, 100, 'jpeg')).toBe('Deck-001.jpeg')
  })

  it('drops the extension of the deck rather than keeping both', () => {
    expect(pictureName('Quarterly review.pptx', 2, 3, 'svg')).toBe('Quarterly review-3.svg')
  })

  it('leaves a name that was not a deck alone', () => {
    expect(pictureName('Presentation', 0, 1, 'png')).toBe('Presentation-1.png')
  })
})
