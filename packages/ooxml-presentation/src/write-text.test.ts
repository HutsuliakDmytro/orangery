import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import type { TextBody } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten } from './shape-tree'
import { setShapeText } from './write-text'
import type { TextLine } from './write-text'

/**
 * The test ADR 0002 asks for: write, save, reopen, read back.
 *
 * A writer checked against its own output only proves it agrees with itself.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** Writes lines into the first shape of the first slide, and reopens. */
async function write(name: string, lines: readonly TextLine[], pick = 0) {
  const pkg = await load(name)
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  const shape = slide === undefined ? undefined : flatten(slide.shapes)[pick]
  if (slide === undefined || shape === undefined) throw new Error('fixture has no shape')

  setShapeText(shape, lines)
  writeSlidePart(pkg, slide)

  const reopened = await readPptxPackage(await saveDeck(pkg))
  return { pkg, reopened, deck: readDeck(reopened), path: slide.path }
}

function firstShape(deck: ReturnType<typeof readDeck>, pick = 0) {
  const slide = deck.slides[0]
  const shape = slide === undefined ? undefined : flatten(slide.shapes)[pick]
  if (shape === undefined) throw new Error('the slide came back empty')
  return shape
}

/** What a shape says, or a failure that names the shape rather than a type. */
function said(text: TextBody | null | undefined): string {
  if (text == null) throw new Error('the shape came back with no text body')
  return textOfBody(text)
}

describe('writing plain lines into a shape', () => {
  it('comes back as what was written', async () => {
    const { deck } = await write('shapes', [{ text: 'Hello' }, { text: 'World' }])
    expect(said(firstShape(deck).text)).toBe('Hello\nWorld')
  })

  it('makes one paragraph per line', async () => {
    const { deck } = await write('shapes', [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }])
    expect(firstShape(deck).text?.paragraphs).toHaveLength(3)
  })

  it('keeps the outline level a line was given', async () => {
    const { deck } = await write('shapes', [
      { text: 'Top' },
      { text: 'Under it', level: 1 },
      { text: 'Deeper', level: 2 },
    ])

    expect(firstShape(deck).text?.paragraphs.map((one) => one.properties.level)).toEqual([0, 1, 2])
  })

  it('writes an empty line as a paragraph with nothing in it', async () => {
    const { deck } = await write('shapes', [{ text: 'Above' }, { text: '' }, { text: 'Below' }])
    const paragraphs = firstShape(deck).text?.paragraphs ?? []

    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[1]?.runs).toHaveLength(0)
  })

  it('leaves every other part of the package alone', async () => {
    const { pkg, reopened, path } = await write('shapes', [{ text: 'Changed' }])

    for (const part of pkg.parts.keys()) {
      if (part === path) continue
      expect(getPartText(reopened, part), part).toBe(getPartText(pkg, part))
    }
  })

  it('gives a shape with no words somewhere to put them', async () => {
    // A shape drawn as pure geometry has no `a:txBody` at all; writing into it
    // has to make one, or the words go nowhere and nobody is told.
    const pkg = await load('shapes')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    const bare =
      slide === undefined ? undefined : flatten(slide.shapes).find((s) => s.text === null)

    if (slide === undefined || bare === undefined) return

    expect(setShapeText(bare, [{ text: 'Now it has words' }])).toBe(true)
    writeSlidePart(pkg, slide)

    const again = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const written = flatten(again.slides[0]?.shapes ?? []).find((s) => s.id === bare.id)
    expect(said(written?.text)).toBe('Now it has words')
  })
})
