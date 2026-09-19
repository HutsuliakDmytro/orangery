import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeProblems, problemsIn } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { addSlide, duplicateSlide, removeSlide } from './add-slide'
import { addComment } from './comments'
import { readDeck } from './deck'
import { addGuide } from './guides'
import { importSlide } from './import-slide'
import { insertPicture } from './insert-picture'
import { readPptxPackage } from './parts'
import { readPresentation } from './presentation'
import { saveDeck } from './save'
import { setSlideSize } from './slide-size'

/**
 * A deck that is still a deck after being edited.
 *
 * Every test in this package asks whether an edit did what it meant to. None of
 * them asks whether the package survived it, and the readers here are lenient
 * enough that it can fail to and still read back perfectly: a second XML
 * declaration, a relationship pointing at a part nobody copied, a new part
 * nothing declares. PowerPoint is stricter than this codebase, and the answer
 * arrives as "do you want to repair this file", on somebody else's machine.
 *
 * Each check goes through a save and a reopen, because that is where a part
 * that was never written and a target that does not exist stop being the same
 * thing as an object in memory.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const decks = (await readdir(FIXTURES))
  .filter((name) => name.endsWith('.pptx'))
  .map((name) => name.replace(/\.pptx$/u, ''))

const load = (name: string): Promise<OoxmlPackage> =>
  readFile(join(FIXTURES, `${name}.pptx`)).then(readPptxPackage)

/** The package as somebody else would open it, with everything wrong with it. */
async function afterSaving(pkg: OoxmlPackage): Promise<string> {
  return describeProblems(problemsIn(await readPptxPackage(await saveDeck(pkg))))
}

const PIXEL = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe.each(decks)('%s', (name) => {
  it('opens sound, which is what the rest of this file is measured against', async () => {
    expect(describeProblems(problemsIn(await load(name)))).toBe('')
  })

  it('is still sound after a slide is added, copied and dropped', async () => {
    const pkg = await load(name)
    const deck = readDeck(pkg)
    const layout = [...deck.layouts.values()][0]
    if (layout !== undefined) addSlide(pkg, deck, layout, 0)

    duplicateSlide(pkg, 0)
    removeSlide(pkg, 1)

    expect(await afterSaving(pkg)).toBe('')
  })

  it('is still sound after a picture, a comment, a guide and a resize', async () => {
    const pkg = await load(name)
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) return

    insertPicture(pkg, slide, {
      fileName: 'pixel.png',
      bytes: PIXEL,
      transform: { x: 0, y: 0, width: 914400, height: 914400 },
    })
    addComment(pkg, slide, { author: { name: 'Olena', initials: 'O' }, text: 'Here' })
    addGuide(pkg, { orientation: 'horz', at: 914400 })
    setSlideSize(pkg, deck, { width: 9144000, height: 6858000 }, 'maximize')

    expect(await afterSaving(pkg)).toBe('')
  })

  it('is still sound after one of its slides is taken into another deck', async () => {
    // The hardest case for a package: a slide arrives from somewhere else and
    // brings a layout, media and whatever parts those name with it.
    const into = await load('empty')
    const from = await load(name)

    const source = readPresentation(from).slides[0]
    if (source === undefined) return
    expect(importSlide(into, from, source.path, 0)).not.toBeNull()

    expect(await afterSaving(into)).toBe('')
  })
})
