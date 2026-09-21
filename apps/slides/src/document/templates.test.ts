import { describe, expect, it } from 'vitest'
import { readDeck, readPptxPackage, slideName, flatten } from '@orangery/ooxml-presentation'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { buildTemplate, DECK_TEMPLATES, templateById } from './templates'

/**
 * Starting from something rather than nothing.
 *
 * A template is content on a package every other deck also uses, so what is
 * worth testing is that the content lands where it was aimed and that the
 * package is still one the app can read — not that the words are the right
 * words.
 */

async function build(id: string) {
  return readPptxPackage(await buildTemplate(templateById(id)))
}

/** Everything written on a slide, in the order it is drawn. */
function textOn(shapes: readonly { text: unknown }[]): string[] {
  return shapes
    .map((shape) => (shape.text === null ? '' : textOfBody(shape.text as never)))
    .filter((text) => text !== '')
}

describe('every template', () => {
  it.each(DECK_TEMPLATES.map((template) => template.id))(
    'builds a readable deck: %s',
    async (id) => {
      const deck = readDeck(await build(id))
      expect(deck.slides.length).toBe(templateById(id).slides.length)
    },
  )

  it.each(DECK_TEMPLATES.map((template) => template.id))(
    'puts each slide on the layout it asked for: %s',
    async (id) => {
      const pkg = await build(id)
      const deck = readDeck(pkg)

      const used = deck.slides.map((slide) => {
        const layout = slide.layout === null ? null : deck.layouts.get(slide.layout)
        return layout === undefined || layout === null ? null : slideName(layout)
      })
      expect(used).toEqual(templateById(id).slides.map((slide) => slide.layout))
    },
  )

  it('names a theme the gallery has', () => {
    for (const template of DECK_TEMPLATES) {
      expect(['Orangery', 'Paper']).toContain(template.theme)
    }
  })
})

describe('the blank template', () => {
  it('is one empty title slide, which is what New Presentation already gives', async () => {
    const deck = readDeck(await build('blank'))
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('no slide')

    expect(deck.slides).toHaveLength(1)
    expect(textOn(flatten(slide.shapes))).toEqual([])
  })
})

describe('a template with words on it', () => {
  it('writes the title where the title goes', async () => {
    const deck = readDeck(await build('pitch'))
    const slide = deck.slides[0]
    const title = slide === undefined ? undefined : flatten(slide.shapes)[0]
    if (title === undefined) throw new Error('no title shape')

    expect(title.placeholder?.type).toBe('ctrTitle')
    expect(title.text === null ? '' : textOfBody(title.text)).toBe('Company')
  })

  it('writes the body lines as separate paragraphs', async () => {
    const deck = readDeck(await build('pitch'))
    const slide = deck.slides[1]
    if (slide === undefined) throw new Error('no second slide')

    const body = flatten(slide.shapes).find((shape) => shape.placeholder?.type !== 'title')
    expect(body?.text?.paragraphs).toHaveLength(3)
  })

  it('keeps the indent level of a line that has one', async () => {
    const deck = readDeck(await build('report'))
    const findings = deck.slides.find((slide) =>
      flatten(slide.shapes).some((shape) =>
        shape.text === null ? false : textOfBody(shape.text).startsWith('Finding'),
      ),
    )
    if (findings === undefined) throw new Error('no findings slide')

    const body = flatten(findings.shapes).find((shape) =>
      shape.text === null ? false : textOfBody(shape.text).startsWith('Finding'),
    )
    expect(body?.text?.paragraphs.map((paragraph) => paragraph.properties.level)).toEqual([
      0, 1, 0, 1,
    ])
  })

  it('fills both sides of a two-content slide', async () => {
    const deck = readDeck(await build('pitch'))
    const market = deck.slides[3]
    if (market === undefined) throw new Error('no market slide')

    const written = textOn(flatten(market.shapes))
    expect(written).toHaveLength(3)
    expect(written[0]).toBe('Market')
  })

  it('leaves a title-only slide with nothing under its title', async () => {
    const deck = readDeck(await build('defence'))
    const last = deck.slides.at(-1)
    if (last === undefined) throw new Error('no last slide')

    expect(textOn(flatten(last.shapes))).toEqual(['Questions'])
  })
})
