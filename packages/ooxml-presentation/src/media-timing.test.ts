import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import { readDeck, readSlidePart } from './deck'
import { autoplayShapes } from './media-timing'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'
import { flatten } from './shape-tree'

/** Which media on a slide starts on its own, and which waits to be asked. */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

const slideOf = async (name: string, index: number) => {
  const slide = readDeck(await load(name)).slides[index]
  if (slide === undefined) throw new Error('fixture changed')
  return slide
}

describe('reading media off a slide', () => {
  it('finds the film behind the poster frame', async () => {
    const shapes = flatten((await slideOf('media', 0)).shapes)
    const film = shapes.find((shape) => shape.media !== null)

    expect(film?.media?.kind).toBe('video')
    expect(film?.media?.relationshipId).not.toBeNull()
  })

  it('finds the embedded copy beside the link', async () => {
    // `a:videoFile` names it with `r:link` even inside the package; the 2010
    // extension names the embedded bytes.
    const shapes = flatten((await slideOf('media', 0)).shapes)
    const film = shapes.find((shape) => shape.media !== null)

    expect(film?.media?.embeddedId).not.toBeNull()
    expect(film?.media?.embeddedId).not.toBe(film?.media?.relationshipId)
  })

  it('tells a sound from a film', async () => {
    const shapes = flatten((await slideOf('media', 1)).shapes)
    const sound = shapes.find((shape) => shape.media !== null)

    expect(sound?.media?.kind).toBe('audio')
  })

  it('still reads the poster frame, which is what is drawn until it plays', async () => {
    const shapes = flatten((await slideOf('media', 0)).shapes)
    const film = shapes.find((shape) => shape.media !== null)

    expect(film?.picture?.relationshipId).not.toBeNull()
  })

  it('says nothing about a picture that is only a picture', async () => {
    const shapes = flatten((await slideOf('picture', 0)).shapes)
    expect(shapes.every((shape) => shape.media === null)).toBe(true)
  })
})

describe('when it starts', () => {
  it('waits for a click where the timing says indefinite', async () => {
    // Which is what a generator writes, and what PowerPoint does by default.
    expect(autoplayShapes(await slideOf('media', 0)).size).toBe(0)
  })

  it('starts with the slide where the timing gives a delay', async () => {
    const pkg = await load('media')
    const text = getPartText(pkg, 'ppt/slides/slide1.xml') ?? ''
    setPartText(pkg, 'ppt/slides/slide1.xml', text.replace('delay="indefinite"', 'delay="0"'))

    const slide = readDeck(await readPptxPackage(await saveDeck(pkg))).slides[0]
    if (slide === undefined) throw new Error('lost the slide')

    expect([...autoplayShapes(slide)]).toEqual([3])
  })

  it('finds nothing on a slide with no timing at all', async () => {
    // A film dropped in and never opened in the animation pane plays on a
    // click, in PowerPoint and here.
    expect(autoplayShapes(await slideOf('picture', 0)).size).toBe(0)
  })

  it('reads it off a part read on its own', async () => {
    const pkg = await load('media')
    const part = readSlidePart(pkg, 'ppt/slides/slide1.xml')
    if (part === null) throw new Error('lost the slide')

    expect(autoplayShapes(part).size).toBe(0)
  })
})

describe('what the file keeps', () => {
  it('writes the deck back byte for byte', async () => {
    const original = await load('media')
    const reopened = await readPptxPackage(await saveDeck(original))

    for (const [path, part] of original.parts) {
      expect(reopened.parts.get(path)?.bytes, path).toStrictEqual(part.bytes)
    }
  })

  it('keeps the media part itself', async () => {
    const pkg = await readPptxPackage(await saveDeck(await load('media')))
    expect([...pkg.parts.keys()].filter((path) => path.startsWith('ppt/media/'))).toHaveLength(3)
  })
})
