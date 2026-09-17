import {
  attribute,
  children,
  deserializeNode,
  element,
  removeAttribute,
  serializeNode,
  setAttribute,
  tagName,
  textValue,
  upsertChild,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { TextBody } from './text-body'

/**
 * DrawingML text as a ProseMirror document, and back.
 *
 * Editing text is the one place a shape cannot be patched element by element:
 * typing splits runs, merges them and deletes them, so the paragraphs are
 * rebuilt. What must not be rebuilt is what each run *carries* — a language
 * tag, a hyperlink, a highlight, an extension list, anything this model does
 * not read.
 *
 * So every run and paragraph keeps its original properties element, and writing
 * patches that element rather than replacing it. A run whose colour changed
 * comes back as its own `a:rPr` with one child different; a run nobody touched
 * comes back byte for byte.
 */

/** The shape of a ProseMirror node, as JSON. No ProseMirror needed to make one. */
export interface PmMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PmNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  text?: string
  marks?: PmMark[]
}

const RUN_PROPERTIES = [
  'a:ln',
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:blipFill',
  'a:pattFill',
  'a:grpFill',
  'a:effectLst',
  'a:highlight',
  'a:uLnTx',
  'a:uLn',
  'a:uFillTx',
  'a:uFill',
  'a:latin',
  'a:ea',
  'a:cs',
  'a:sym',
  'a:hlinkClick',
  'a:hlinkMouseOver',
  'a:rtl',
  'a:extLst',
]

/** The marks a run's properties amount to. */
function marksOf(properties: XmlNode | undefined): PmMark[] {
  if (properties === undefined) return []

  const marks: PmMark[] = []
  const on = (name: string) => {
    const value = attribute(properties, name)
    return value === '1' || value === 'true'
  }

  if (on('b')) marks.push({ type: 'bold' })
  if (on('i')) marks.push({ type: 'italic' })

  const underline = attribute(properties, 'u')
  if (underline !== undefined && underline !== 'none') marks.push({ type: 'underline' })

  /**
   * Size and typeface go on one mark rather than two.
   *
   * That is Tiptap's `textStyle`, which is how Docs already carries run
   * properties, and the reason the editor package serves both apps without an
   * adapter between them.
   */
  const size = Number(attribute(properties, 'sz'))
  const latin = children(properties).find((child) => tagName(child) === 'a:latin')
  const typeface = latin === undefined ? undefined : attribute(latin, 'typeface')

  const style: Record<string, unknown> = {}
  if (Number.isFinite(size)) style['fontSize'] = size / 100
  if (typeface !== undefined) style['fontFamily'] = typeface
  if (Object.keys(style).length > 0) marks.push({ type: 'textStyle', attrs: style })

  /**
   * Everything else, carried as written — the colour included.
   *
   * A theme colour has to stay symbolic, and there is nowhere in a CSS-shaped
   * editor mark to put `accent1`. Keeping the whole `a:rPr` means the colour
   * survives untouched; changing a colour is the properties panel's job, where
   * a theme slot can be named.
   */
  marks.push({ type: 'preservedRunProperties', attrs: { xml: serializeNode(properties) } })

  return marks
}

/** The text of an `a:t`, which holds it as a child node. */
function textOf(node: XmlNode): string {
  return children(node)
    .map((child) => textValue(child))
    .join('')
}

/**
 * Reads a text body into a ProseMirror document.
 *
 * Walks the elements rather than the parsed model: each run's properties sit
 * beside it in the tree, and finding them any other way — by matching the text,
 * say — would hand two runs that read the same the same formatting.
 */
export function textBodyToDoc(body: TextBody): PmNode {
  const paragraphs = children(body.node)
    .filter((child) => tagName(child) === 'a:p')
    .map((paragraph): PmNode => {
      const properties = children(paragraph).find((child) => tagName(child) === 'a:pPr')
      const end = children(paragraph).find((child) => tagName(child) === 'a:endParaRPr')

      const content = children(paragraph).flatMap((child): PmNode[] => {
        const tag = tagName(child)

        if (tag === 'a:br') return [{ type: 'hardBreak' }]
        if (tag !== 'a:r' && tag !== 'a:fld') return []

        const value = children(child).find((one) => tagName(one) === 'a:t')
        const text = value === undefined ? '' : textOf(value)
        if (text === '') return []

        return [
          {
            type: 'text',
            text,
            marks: marksOf(children(child).find((one) => tagName(one) === 'a:rPr')),
          },
        ]
      })

      const level = Number(properties === undefined ? undefined : attribute(properties, 'lvl'))

      return {
        type: 'paragraph',
        attrs: {
          level: Number.isFinite(level) ? level : 0,
          align: (properties === undefined ? undefined : attribute(properties, 'algn')) ?? null,
          pPrOriginal: properties === undefined ? null : serializeNode(properties),
          // An empty paragraph carries its formatting here and nowhere else.
          endParaRPr: end === undefined ? null : serializeNode(end),
        },
        content,
      }
    })

  return { type: 'doc', content: paragraphs }
}

/** Patches a run's properties with what the marks say, keeping the rest. */
function propertiesFor(marks: readonly PmMark[]): XmlNode | null {
  const preserved = marks.find((mark) => mark.type === 'preservedRunProperties')
  const xml = typeof preserved?.attrs?.['xml'] === 'string' ? preserved.attrs['xml'] : null
  const properties = xml === null ? element('a:rPr', { lang: 'en-US' }) : deserializeNode(xml)
  if (properties === null) return null

  const has = (type: string) => marks.some((mark) => mark.type === type)

  if (has('bold')) setAttribute(properties, 'b', '1')
  else removeAttribute(properties, 'b')

  if (has('italic')) setAttribute(properties, 'i', '1')
  else removeAttribute(properties, 'i')

  if (has('underline')) setAttribute(properties, 'u', 'sng')
  else removeAttribute(properties, 'u')

  const style = marks.find((mark) => mark.type === 'textStyle')?.attrs
  const size = style?.['fontSize']
  if (typeof size === 'number') setAttribute(properties, 'sz', String(Math.round(size * 100)))

  const family = style?.['fontFamily']
  if (typeof family === 'string') {
    upsertChild(properties, element('a:latin', { typeface: family }), RUN_PROPERTIES)
  }

  return properties
}

/** Rebuilds the `a:p` elements of a body from a document. */
export function docToParagraphs(doc: PmNode): XmlNode[] {
  return (doc.content ?? []).map((paragraph) => {
    const original = paragraph.attrs?.['pPrOriginal']
    const properties = typeof original === 'string' ? deserializeNode(original) : null

    const runs = (paragraph.content ?? []).flatMap((node): XmlNode[] => {
      if (node.type === 'hardBreak') return [element('a:br')]
      if (node.type !== 'text' || node.text === undefined) return []

      const rPr = propertiesFor(node.marks ?? [])
      return [
        element('a:r', {}, [
          ...(rPr === null ? [] : [rPr]),
          element('a:t', {}, [{ '#text': node.text }]),
        ]),
      ]
    })

    const end = paragraph.attrs?.['endParaRPr']
    const endNode = typeof end === 'string' ? deserializeNode(end) : null

    return element('a:p', {}, [
      ...(properties === null ? [] : [properties]),
      ...runs,
      ...(endNode === null ? [] : [endNode]),
    ])
  })
}

/**
 * Writes a document back into a text body's element.
 *
 * `a:bodyPr` and `a:lstStyle` are left exactly as they were: they describe the
 * box and its defaults, not the text, and nothing here has an opinion on them.
 */
export function writeTextBody(node: XmlNode, doc: PmNode): boolean {
  const kept = children(node).filter((child) => {
    const tag = tagName(child)
    return tag === 'a:bodyPr' || tag === 'a:lstStyle'
  })

  const paragraphs = docToParagraphs(doc)
  const siblings = children(node)
  siblings.length = 0
  siblings.push(...kept, ...paragraphs)

  return true
}
