import {
  children,
  findChild,
  isTextNode,
  parseXml,
  readPackage,
  tagName,
  textValue,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { TemplateSlide } from '../templates'
import { buildTemplate } from '../templates'

/**
 * A document's headings as a deck.
 *
 * What a person means by "turn this into slides" is the outline: a heading
 * starts a slide and what is under it becomes the bullets. Nothing else in the
 * document comes across — a table, a picture, a footnote is not a thing an
 * outline has, and importing them would be importing the document rather than
 * its shape.
 *
 * Read here rather than through the Docs app's engine. An outline is headings
 * and their text, which is three elements of WordprocessingML; reaching into
 * another app for it would be the one thing the monorepo does not allow, and
 * building a shared package for sixty lines would be the wrong shape of answer.
 */

export interface OutlineItem {
  /** Zero is a slide title; everything deeper is a bullet under it. */
  level: number
  text: string
}

/** The words of a paragraph, across however many runs they are split into. */
function textOf(node: XmlNode): string {
  return children(node)
    .map((child) => {
      if (isTextNode(child)) return textValue(child)
      // A tab or a break inside a heading is a space, not a character to keep.
      const tag = tagName(child)
      if (tag === 'w:tab' || tag === 'w:br') return ' '
      return textOf(child)
    })
    .join('')
}

/**
 * The outline level a paragraph is at, or null for one that is not a heading.
 *
 * `Heading1` through `Heading9` in the style id, which is what Word writes
 * whatever the style is called in the interface; `Title` counts as the first
 * level, because a document's title is the first thing a deck says.
 */
function levelOf(paragraph: XmlNode): number | null {
  const properties = findChild(paragraph, 'w:pPr')
  const style = properties === undefined ? undefined : findChild(properties, 'w:pStyle')
  const id = style === undefined ? undefined : (style[':@'] as Record<string, string> | undefined)
  const name = id?.['@_w:val'] ?? ''

  if (/^title$/iu.test(name)) return 0

  const heading = /^heading(\d)$/iu.exec(name)
  return heading?.[1] === undefined ? null : Number(heading[1]) - 1
}

/**
 * Reads the headings of a `.docx`.
 *
 * Paragraphs that are not headings are dropped. A deck made of every sentence
 * in a document is a deck nobody can present, and the outline is the part of a
 * document that already has the shape of one.
 */
export async function readOutline(bytes: Uint8Array): Promise<OutlineItem[]> {
  const pkg = await readPackage(bytes, 'word/document.xml')
  const text = pkg.parts.get('word/document.xml')?.text ?? ''

  const root = parseXml(text).find((node) => tagName(node) === 'w:document')
  const body = root === undefined ? undefined : findChild(root, 'w:body')
  if (body === undefined) return []

  return children(body).flatMap((paragraph): OutlineItem[] => {
    if (tagName(paragraph) !== 'w:p') return []

    const level = levelOf(paragraph)
    const words = textOf(paragraph).trim()
    return level === null || words === '' ? [] : [{ level, text: words }]
  })
}

/**
 * The slides an outline makes.
 *
 * A top-level heading starts a slide; everything under it until the next one
 * becomes its bullets, at the depth it had in the document. Text before any
 * heading has no slide to be on and is dropped — which cannot happen in a
 * document with a title, and is the only honest answer in one without.
 */
export function slidesFromOutline(items: readonly OutlineItem[]): TemplateSlide[] {
  const slides: TemplateSlide[] = []

  for (const item of items) {
    if (item.level === 0) {
      // The first one is the deck's title slide. A document's first heading is
      // what it is called, and a deck that opened on a bulleted list would be
      // a deck missing the thing it is about.
      slides.push({
        layout: slides.length === 0 ? 'Title Slide' : 'Title and Content',
        title: item.text,
        body: [],
      })
      continue
    }

    const open = slides[slides.length - 1]
    if (open === undefined) continue

    // One level in the document is one level in the deck, and the deepest a
    // body placeholder goes is five.
    open.body = [...(open.body ?? []), { text: item.text, level: Math.min(item.level - 1, 4) }]
  }

  return slides
}

/** A deck built from a document's outline, ready to open. */
export async function deckFromOutline(bytes: Uint8Array): Promise<Uint8Array | null> {
  const slides = slidesFromOutline(await readOutline(bytes))
  if (slides.length === 0) return null

  return buildTemplate({
    id: 'outline',
    name: 'Outline',
    description: '',
    theme: 'Orangery',
    slides,
  })
}
