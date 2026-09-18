import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck, readPptxPackage } from '@orangery/ooxml-presentation'
import { describeSlides, inspect } from './warnings'

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const deckOf = async (name: string) =>
  readDeck(await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`))))

describe('inspect', () => {
  it('says nothing about a deck we can draw', async () => {
    // Warning about something that renders correctly teaches people to ignore
    // the banner.
    expect(inspect(await deckOf('shapes'))).toEqual([])
    expect(inspect(await deckOf('placeholders'))).toEqual([])
  })

  it('says nothing about a table, which is drawn properly', async () => {
    expect(inspect(await deckOf('table'))).toEqual([])
  })

  it('groups one message across the slides it applies to', async () => {
    const deck = await deckOf('many-slides')
    const slides = deck.slides.map((slide) => ({
      ...slide,
      shapes: [
        {
          ...(slide.shapes[0] ?? {
            kind: 'sp' as const,
            id: 1,
            name: '',
            description: '',
            hidden: false,
            transform: null,
            placeholder: null,
            properties: null,
            style: null,
            text: null,
            picture: null,
            connection: null,
            graphic: null,
            shapes: [],
            node: {},
          }),
          graphic: { kind: 'chart' as const, uri: null, table: null, relationshipId: 'rId1' },
        },
      ],
    }))

    const warnings = inspect({ ...deck, slides })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.slides).toHaveLength(8)
  })
})

describe('describeSlides', () => {
  it('names one slide', () => {
    expect(describeSlides([3])).toBe('slide 3')
  })

  it('lists a few', () => {
    expect(describeSlides([3, 7, 9])).toBe('slides 3, 7 and 9')
  })

  it('counts rather than lists when there are many', () => {
    // A banner listing forty numbers is a banner nobody reads.
    expect(describeSlides([1, 2, 3, 4, 5, 6])).toBe('6 slides')
  })
})
