import { children, findChild, tagName, textValue } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { Deck, Slide } from './deck'
import { flatten } from './shape-tree'
import type { Shape } from './shape-tree'

/**
 * Finding and replacing text across a deck.
 *
 * A match does not respect run boundaries. "Presentation" can be written as
 * three runs because someone bolded the middle of it, and a search that looked
 * at one run at a time would not find it — while a person looking at the slide
 * sees one word. So a paragraph's runs are joined, the match is found in the
 * whole, and the replacement is written back across however many runs it
 * spanned.
 *
 * The first run of a match keeps the replacement and its own formatting; the
 * rest of the matched text is removed from the runs that held it. That is what
 * PowerPoint does, and the alternative — spreading the new text over the old
 * runs by length — puts letters in the wrong style whenever the lengths differ.
 */

export interface Match {
  /** One-based, as a person counts slides. */
  slide: number
  shapeId: number
  /** The text of the paragraph the match was found in, for showing it. */
  context: string
  start: number
  length: number
}

export interface SearchOptions {
  caseSensitive?: boolean
  /** Only whole words, so "art" does not match "part". */
  wholeWord?: boolean
}

const boundary = /[\p{L}\p{N}_]/u

function indicesOf(haystack: string, needle: string, options: SearchOptions): number[] {
  if (needle === '') return []

  const text = options.caseSensitive === true ? haystack : haystack.toLowerCase()
  const query = options.caseSensitive === true ? needle : needle.toLowerCase()
  const found: number[] = []

  let at = text.indexOf(query)
  while (at !== -1) {
    const before = text[at - 1]
    const after = text[at + query.length]
    const whole =
      options.wholeWord !== true ||
      ((before === undefined || !boundary.test(before)) &&
        (after === undefined || !boundary.test(after)))

    if (whole) found.push(at)
    at = text.indexOf(query, at + 1)
  }

  return found
}

/** The `a:t` elements of a paragraph, in order, with the text each holds. */
function runsOf(paragraph: XmlNode): { node: XmlNode; text: string }[] {
  return children(paragraph).flatMap((child) => {
    if (tagName(child) !== 'a:r' && tagName(child) !== 'a:fld') return []

    const value = findChild(child, 'a:t')
    if (value === undefined) return []

    return [
      {
        node: value,
        text: children(value)
          .map((one) => textValue(one))
          .join(''),
      },
    ]
  })
}

/** Every text body on a shape: its own, and every cell of a table it holds. */
function bodiesOf(shape: Shape): XmlNode[] {
  const own = shape.text === null ? [] : [shape.text.node]
  const table = shape.graphic?.table
  if (table == null) return own

  return [
    ...own,
    ...table.rows.flatMap((row) =>
      row.cells.flatMap((cell) => (cell.text === null ? [] : [cell.text.node])),
    ),
  ]
}

const paragraphsOf = (body: XmlNode) => children(body).filter((child) => tagName(child) === 'a:p')

export function findInDeck(deck: Deck, query: string, options: SearchOptions = {}): Match[] {
  return deck.slides.flatMap((slide, index) =>
    flatten(slide.shapes).flatMap((shape) =>
      bodiesOf(shape).flatMap((body) =>
        paragraphsOf(body).flatMap((paragraph) => {
          const text = runsOf(paragraph)
            .map((run) => run.text)
            .join('')

          return indicesOf(text, query, options).map((start) => ({
            slide: index + 1,
            shapeId: shape.id,
            context: text,
            start,
            length: query.length,
          }))
        }),
      ),
    ),
  )
}

/** Puts a string into an `a:t`, which holds its text as a child node. */
function setText(value: XmlNode, text: string): void {
  const nodes = children(value)
  nodes.length = 0
  if (text !== '') nodes.push({ '#text': text })
}

/**
 * Replaces every match in one paragraph. Returns how many.
 *
 * Works from the last match backwards so that earlier offsets stay valid — the
 * replacement is rarely the same length as what it replaced.
 */
function replaceInParagraph(
  paragraph: XmlNode,
  query: string,
  replacement: string,
  options: SearchOptions,
): number {
  const runs = runsOf(paragraph)
  if (runs.length === 0) return 0

  const text = runs.map((run) => run.text).join('')
  const matches = indicesOf(text, query, options)
  if (matches.length === 0) return 0

  // Each run's span in the joined text, so a match can be mapped back onto the
  // runs it covers.
  const spans: { run: (typeof runs)[number]; from: number; to: number }[] = []
  let at = 0
  for (const run of runs) {
    spans.push({ run, from: at, to: at + run.text.length })
    at += run.text.length
  }

  const updated = new Map(runs.map((run) => [run.node, run.text]))

  for (const start of [...matches].reverse()) {
    const end = start + query.length
    let written = false

    for (const span of spans) {
      if (span.to <= start || span.from >= end) continue

      const current = updated.get(span.run.node) ?? ''
      const localStart = Math.max(start - span.from, 0)
      const localEnd = Math.min(end - span.from, current.length)

      updated.set(
        span.run.node,
        // The first run the match touches takes the whole replacement; the
        // others lose their part of it. Splitting the new text across them by
        // length would style letters by where the old ones happened to sit.
        current.slice(0, localStart) + (written ? '' : replacement) + current.slice(localEnd),
      )
      written = true
    }
  }

  for (const [node, text] of updated) setText(node, text)
  return matches.length
}

/** Replaces across a slide, in every shape and every table cell. Returns how many. */
export function replaceInSlide(
  slide: Slide,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): number {
  if (query === '') return 0

  return flatten(slide.shapes)
    .flatMap(bodiesOf)
    .flatMap(paragraphsOf)
    .reduce(
      (count, paragraph) => count + replaceInParagraph(paragraph, query, replacement, options),
      0,
    )
}

/** Replaces across every slide. Returns how many were changed. */
export function replaceInDeck(
  deck: Deck,
  query: string,
  replacement: string,
  options: SearchOptions = {},
): number {
  return deck.slides.reduce(
    (count, slide) => count + replaceInSlide(slide, query, replacement, options),
    0,
  )
}
