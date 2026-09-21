import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { XML_DECLARATION, getPartText } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { PRESENTATION_PART, readPptxPackage } from './parts'
import { rewriteEveryPart, saveDeck } from './save'
import { setSlideSize } from './slide-size'

/**
 * Open, save, and get the same file back.
 *
 * This is the guarantee, not a feature of it. The test is deliberately harsher
 * than an ordinary save: every part holding a shape tree is forced through
 * parse and serialise, so it fails if the two are not exactly inverse — even on
 * markup nothing reads, which is the markup most likely to be silently dropped.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const decks = (await readdir(FIXTURES))
  .filter((name) => name.endsWith('.pptx'))
  .map((name) => name.replace(/\.pptx$/u, ''))

describe('the corpus', () => {
  it('is not silently empty', () => {
    expect(decks.length).toBeGreaterThanOrEqual(10)
  })
})

describe.each(decks)('%s', (name) => {
  const load = async () => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

  it('keeps every part byte for byte when nothing is edited', async () => {
    const original = await load()
    const reopened = await readPptxPackage(await saveDeck(original))

    expect([...reopened.parts.keys()]).toEqual([...original.parts.keys()])
    for (const [path, part] of original.parts) {
      expect(reopened.parts.get(path)?.bytes, path).toStrictEqual(part.bytes)
    }
  })

  it('serialises every shape tree back to the text it was parsed from', async () => {
    const pkg = await load()
    const before = new Map([...pkg.parts].map(([path, part]) => [path, part.text]))

    rewriteEveryPart(pkg, readDeck(pkg))

    for (const [path, text] of before) {
      expect(getPartText(pkg, path), path).toBe(text)
    }
  })
})

/**
 * An edited part is still one XML document.
 *
 * The writers here parse a part, patch the tree and build it back — and the
 * `<?xml?>` node comes out of the tree with everything else, so prepending a
 * declaration to the result wrote two of them. Nothing in this package minds
 * (the readers look for an element by name), which is exactly why it went
 * unnoticed: the file stops being well-formed XML and PowerPoint is the one
 * that says so.
 */
describe.each(decks)('%s, once edited', (name) => {
  it('has one declaration in the part that was written', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
    const deck = readDeck(pkg)
    const bigger = { width: deck.slideSize.width + 914400, height: deck.slideSize.height }

    expect(setSlideSize(pkg, deck, bigger, 'maximize')).toBe(true)

    const text = getPartText(pkg, PRESENTATION_PART) ?? ''
    expect([...text.matchAll(/<\?xml/gu)]).toHaveLength(1)
    expect(text.startsWith(XML_DECLARATION)).toBe(true)
  })
})
