import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { moveShape, readDeck, readPptxPackage, removeSlides } from '@orangery/ooxml-presentation'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import { buildSnapshot, packageFrom, parseSnapshot, partsOf } from './autosave'
import { useDeckStore } from '../store/deck-store'

/**
 * What a crash leaves behind.
 *
 * The snapshot is the difference between the deck in the window and the file it
 * came from, so the two halves worth testing are that the store knows what that
 * difference is, and that the difference survives a trip through JSON.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function open(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
}

/** The open deck, or a failure that says the test never got one. */
function deck() {
  const open = useDeckStore.getState().open
  if (open === null) throw new Error('no deck is open')
  return open
}

/** The part the fixture's first slide lives in. */
function firstSlide(): string {
  const path = deck().deck.slides[0]?.path
  if (path === undefined) throw new Error('fixture has no slides')
  return path
}

/** What the store would put in a snapshot right now. */
function snapshotNow(path: string) {
  return buildSnapshot(path, deck().package, useDeckStore.getState().dirtyParts)
}

/** Nudges the first shape on the current slide, which is the smallest real edit. */
function moveSomething() {
  useDeckStore.getState().edit((slide) => {
    const shape = slide.shapes[0]
    return shape === undefined ? false : moveShape(shape, { x: 12700, y: 0 })
  })
}

beforeEach(() => {
  useDeckStore.getState().close()
})

describe('what the store counts as dirty', () => {
  it('starts with nothing to recover', async () => {
    await open('shapes')

    expect(useDeckStore.getState().dirtyParts.size).toBe(0)
    expect(useDeckStore.getState().saved).toBe(true)
  })

  it('records the part an edit rewrote, and nothing else', async () => {
    await open('shapes')
    moveSomething()

    expect([...useDeckStore.getState().dirtyParts]).toEqual([firstSlide()])
  })

  it('bumps the revision on every edit, so a pause can be noticed', async () => {
    await open('shapes')

    moveSomething()
    const first = useDeckStore.getState().revision
    moveSomething()

    expect(useDeckStore.getState().revision).toBeGreaterThan(first)
  })

  it('counts an undo as a change, because the file no longer matches either', async () => {
    await open('shapes')
    moveSomething()
    useDeckStore.getState().markSaved('/decks/shapes.pptx')

    useDeckStore.getState().undo()

    expect(useDeckStore.getState().saved).toBe(false)
    expect(useDeckStore.getState().dirtyParts.size).toBeGreaterThan(0)
  })

  it('forgets everything once the deck is on disk', async () => {
    await open('shapes')
    moveSomething()
    useDeckStore.getState().markSaved('/decks/shapes.pptx')

    expect(useDeckStore.getState().dirtyParts.size).toBe(0)
  })

  it('records a deleted slide as the change to the presentation part', async () => {
    await open('many-slides')
    useDeckStore.getState().editPackage((state) => removeSlides(state.package, [1]))

    // Deleting a slide takes its entry out of `sldIdLst` and leaves the part
    // orphaned, so that one part is the whole of what a recovery needs.
    expect([...useDeckStore.getState().dirtyParts]).toContain('ppt/presentation.xml')
  })
})

describe('the snapshot itself', () => {
  it('carries the text of every dirty part', async () => {
    await open('shapes')
    moveSomething()

    const slide = firstSlide()
    const snapshot = snapshotNow('/decks/shapes.pptx')

    expect(snapshot.parts).toHaveLength(1)
    expect(snapshot.parts[0]?.path).toBe(slide)
    expect(snapshot.parts[0]?.text).toBe(getPartText(deck().package, slide))
  })

  it('carries media as bytes rather than as text it does not have', async () => {
    const pkg = await readPackage(await readFile(join(FIXTURES, 'picture.pptx')))
    const media = [...pkg.parts.keys()].find((path) => path.startsWith('ppt/media/'))
    if (media === undefined) throw new Error('fixture has no picture')

    const snapshot = buildSnapshot('/decks/picture.pptx', pkg, new Set([media]))

    expect(snapshot.parts[0]?.text).toBeUndefined()
    expect(partsOf(snapshot)[0]?.bytes).toEqual(pkg.parts.get(media)?.bytes)
  })

  it('survives the trip through JSON', async () => {
    await open('shapes')
    moveSomething()

    // Built once: `savedAt` is the clock, and two calls would disagree.
    const snapshot = snapshotNow('/decks/shapes.pptx')

    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('skips a dirty path whose part has since gone', async () => {
    await open('shapes')
    const snapshot = buildSnapshot(
      '/decks/shapes.pptx',
      deck().package,
      new Set(['ppt/slides/slide99.xml']),
    )

    expect(snapshot.parts).toHaveLength(0)
  })
})

describe('a deck that has no file behind it', () => {
  it('is carried whole, since there is nothing to be a difference from', async () => {
    await open('shapes')
    const snapshot = buildSnapshot(null, deck().package, new Set())

    // Nothing is dirty and everything is in it: the empty set is not the answer
    // when the answer to "what is on disk" is nothing.
    expect(snapshot.parts.length).toBe(deck().package.parts.size)
  })

  it('comes back as a deck that can be read again', async () => {
    await open('shapes')
    const slide = firstSlide()
    moveSomething()
    const snapshot = buildSnapshot(null, deck().package, new Set())

    const rebuilt = await readPptxPackage(await packageFrom(snapshot))

    expect(getPartText(rebuilt, slide)).toBe(getPartText(deck().package, slide))
    expect(readDeck(rebuilt).slides).toHaveLength(deck().deck.slides.length)
  })

  it('brings its pictures with it', async () => {
    await open('picture')
    const snapshot = buildSnapshot(null, deck().package, new Set())
    const media = [...deck().package.parts.keys()].find((path) => path.startsWith('ppt/media/'))
    if (media === undefined) throw new Error('fixture has no picture')

    const rebuilt = await readPptxPackage(await packageFrom(snapshot))

    expect(rebuilt.parts.get(media)?.bytes).toEqual(deck().package.parts.get(media)?.bytes)
  })
})

describe('reading a snapshot back', () => {
  const valid = {
    version: 1,
    path: '/decks/shapes.pptx',
    savedAt: '2026-09-18T10:00:00.000Z',
    parts: [{ path: 'ppt/slides/slide1.xml', text: '<p:sld/>' }],
  }

  it('accepts one this build wrote', () => {
    expect(parseSnapshot(JSON.stringify(valid))?.path).toBe('/decks/shapes.pptx')
  })

  it('refuses one from a schema it does not know', () => {
    expect(parseSnapshot(JSON.stringify({ ...valid, version: 2 }))).toBeNull()
  })

  it('accepts one from a deck that was never saved', () => {
    expect(parseSnapshot(JSON.stringify({ ...valid, path: null }))?.path).toBeNull()
  })

  it('refuses one whose path is missing rather than absent', () => {
    // An empty string is not "no file" — it is a snapshot that lost its path.
    expect(parseSnapshot(JSON.stringify({ ...valid, path: '' }))).toBeNull()
  })

  it('refuses one truncated mid-write rather than recovering part of it', () => {
    expect(parseSnapshot(JSON.stringify(valid).slice(0, 60))).toBeNull()
  })

  it('refuses one whose part says nothing about its contents', () => {
    const broken = { ...valid, parts: [{ path: 'ppt/slides/slide1.xml' }] }
    expect(parseSnapshot(JSON.stringify(broken))).toBeNull()
  })
})

describe('putting a snapshot back', () => {
  it('replays the edit onto the file it was taken from', async () => {
    await open('shapes')
    moveSomething()

    const slide = firstSlide()
    const edited = snapshotNow('/decks/shapes.pptx')

    // The crash: the deck is gone and the untouched file is opened again.
    await open('shapes')
    expect(getPartText(deck().package, slide)).not.toBe(edited.parts[0]?.text)

    useDeckStore.getState().restore(partsOf(edited))

    expect(getPartText(deck().package, slide)).toBe(edited.parts[0]?.text)
    // Recovered work has never been in a file, and saying otherwise would lose
    // it the next time the window closed.
    expect(useDeckStore.getState().saved).toBe(false)
    expect([...useDeckStore.getState().dirtyParts]).toEqual([slide])
  })

  it('leaves a deleted slide deleted', async () => {
    await open('many-slides')
    const before = deck().deck.slides.length
    useDeckStore.getState().editPackage((state) => removeSlides(state.package, [1]))

    const snapshot = snapshotNow('/decks/many-slides.pptx')

    await open('many-slides')
    useDeckStore.getState().restore(partsOf(snapshot))

    expect(deck().deck.slides).toHaveLength(before - 1)
  })
})
