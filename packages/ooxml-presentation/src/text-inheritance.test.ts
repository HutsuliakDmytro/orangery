import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveColor } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { colorContextFor, readThemes } from './theme-context'
import {
  listStyleChain,
  masterStyleFor,
  readMasterTextStyles,
  resolveParagraphProperties,
  resolveRunProperties,
} from './text-inheritance'
import type { Shape } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function load(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  return { pkg, deck, themes: readThemes(pkg, deck) }
}

/** The resolved properties of a shape's first paragraph. */
async function firstParagraphOf(name: string, pick: (shape: Shape) => boolean) {
  const { deck, themes } = await load(name)
  const slide = deck.slides[0]
  const shape = slide?.shapes.find(pick)
  const paragraph = shape?.text?.paragraphs[0]
  if (!slide || !shape || !paragraph) throw new Error('fixture does not hold what the test needs')

  const chain = listStyleChain(deck, slide, shape)
  const properties = resolveParagraphProperties(paragraph.properties, chain)

  return {
    properties,
    run: resolveRunProperties(paragraph.runs[0]?.properties ?? null, properties),
    context: colorContextFor(deck, themes, slide),
    chain,
  }
}

describe('the master text styles', () => {
  it('reads all three, which live beside the shape tree rather than on it', async () => {
    const { deck } = await load('placeholders')
    const [master] = [...deck.masters.values()]
    const styles = master ? readMasterTextStyles(master) : null

    expect(styles?.title.size).toBeGreaterThan(0)
    expect(styles?.body.size).toBeGreaterThan(0)
    expect(styles?.other.size).toBeGreaterThan(0)
  })

  it('gives a title the title style and a body the body style', async () => {
    const { deck } = await load('placeholders')
    const slide = deck.slides[0]
    const [master] = [...deck.masters.values()]
    const styles = master ? readMasterTextStyles(master) : null
    const title = slide?.shapes.find((shape) => shape.placeholder?.type === 'title')
    const body = slide?.shapes.find((shape) => shape.placeholder?.index === 1)

    expect(styles && title ? masterStyleFor(styles, title) : null).toBe(styles?.title)
    expect(styles && body ? masterStyleFor(styles, body) : null).toBe(styles?.body)
  })

  it('gives a shape that is no placeholder the other style', async () => {
    const { deck } = await load('shapes')
    const [master] = [...deck.masters.values()]
    const styles = master ? readMasterTextStyles(master) : null
    const rectangle = deck.slides[0]?.shapes[0]

    expect(rectangle?.placeholder).toBeNull()
    expect(styles && rectangle ? masterStyleFor(styles, rectangle) : null).toBe(styles?.other)
  })
})

describe('what a title inherits', () => {
  it('takes its size from the master, which the slide never states', async () => {
    const { properties, run } = await firstParagraphOf(
      'placeholders',
      (shape) => shape.placeholder?.type === 'title',
    )

    expect(properties.align).toBe('ctr')
    expect(run?.size).toBe(44)
  })

  it('takes the heading typeface reference, not the body one', async () => {
    const { run } = await firstParagraphOf(
      'placeholders',
      (shape) => shape.placeholder?.type === 'title',
    )
    expect(run?.font).toBe('+mj-lt')
  })

  it('inherits no bullet, because a title states buNone', async () => {
    const { properties } = await firstParagraphOf(
      'placeholders',
      (shape) => shape.placeholder?.type === 'title',
    )
    expect(properties.bullet).toEqual({ kind: 'none' })
  })
})

describe('what a body inherits', () => {
  it('takes the bullet character and the hanging indent from the master', async () => {
    const { properties } = await firstParagraphOf(
      'placeholders',
      (shape) => shape.placeholder?.index === 1,
    )

    expect(properties.bullet).toEqual({ kind: 'character', character: '•', font: 'Arial' })
    expect(properties).toMatchObject({ marginLeft: 342900, indent: -342900 })
  })

  it('takes the body typeface and a colour the theme can resolve', async () => {
    const { run, context } = await firstParagraphOf(
      'placeholders',
      (shape) => shape.placeholder?.index === 1,
    )

    expect(run?.font).toBe('+mn-lt')
    // tx1 is only answerable through the master's colour map.
    expect(run?.color ? resolveColor(run.color, context)?.hex : null).toBe('#000000')
  })
})

describe('merging', () => {
  it('keeps the inherited bullet when the paragraph sets only its alignment', async () => {
    const { deck } = await load('placeholders')
    const slide = deck.slides[0]
    const body = slide?.shapes.find((shape) => shape.placeholder?.index === 1)
    const paragraph = body?.text?.paragraphs[0]
    if (!slide || !body || !paragraph) throw new Error('fixture changed')

    const chain = listStyleChain(deck, slide, body)
    const resolved = resolveParagraphProperties(
      { ...paragraph.properties, align: 'r', bullet: null },
      chain,
    )

    expect(resolved.align).toBe('r')
    expect(resolved.bullet).toEqual({ kind: 'character', character: '•', font: 'Arial' })
  })

  it('lets a run override what the paragraph defaults to', async () => {
    const { deck } = await load('text-formatting')
    const slide = deck.slides[0]
    const box = slide?.shapes[0]
    const paragraph = box?.text?.paragraphs[0]
    if (!slide || !box || !paragraph) throw new Error('fixture changed')

    const properties = resolveParagraphProperties(
      paragraph.properties,
      listStyleChain(deck, slide, box),
    )
    const large = resolveRunProperties(paragraph.runs[3]?.properties ?? null, properties)

    expect(large?.size).toBe(32)
  })

  it('reaches the presentation default for a shape that is no placeholder', async () => {
    const { deck } = await load('text-formatting')
    const slide = deck.slides[0]
    const box = slide?.shapes[0]
    if (!slide || !box) throw new Error('fixture changed')

    const chain = listStyleChain(deck, slide, box)
    expect(chain[chain.length - 1]).toBe(deck.defaultTextStyle)
    expect(deck.defaultTextStyle.size).toBeGreaterThan(0)
  })
})
