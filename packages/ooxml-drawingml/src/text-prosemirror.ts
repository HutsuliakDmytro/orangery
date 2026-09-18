import {
  attribute,
  children,
  deserializeNode,
  element,
  removeAttribute,
  removeChild,
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

/**
 * A colour the editor can carry, or null for one it cannot.
 *
 * Only a literal `a:srgbClr` comes across. A theme colour is `accent1`, and a
 * mark shaped like CSS has nowhere to put that — so it stays in the preserved
 * properties and is written back untouched. Flattening it to the hex it happens
 * to resolve to today would quietly detach the run from its theme.
 */
function literalColorOf(properties: XmlNode, tag: string): string | null {
  const holder = children(properties).find((child) => tagName(child) === tag)
  if (holder === undefined) return null

  const value = children(holder).find((child) => tagName(child) === 'a:srgbClr')
  const hex = value === undefined ? undefined : attribute(value, 'val')

  // A colour carrying transforms — an alpha, a shade — is not a hex either:
  // the editor would drop them, and dropping them is a change nobody asked for.
  if (hex === undefined || children(value ?? properties).length > 0) return null
  return `#${hex.toUpperCase()}`
}

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

  const strike = attribute(properties, 'strike')
  if (strike !== undefined && strike !== 'noStrike') marks.push({ type: 'strike' })

  // `baseline` is a raise or a drop as thousandths of a percent; the sign is
  // the whole of what a superscript and a subscript differ by.
  const baseline = Number(attribute(properties, 'baseline'))
  if (Number.isFinite(baseline) && baseline > 0) marks.push({ type: 'superscript' })
  if (Number.isFinite(baseline) && baseline < 0) marks.push({ type: 'subscript' })

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

  const caps = attribute(properties, 'cap')
  if (caps === 'all' || caps === 'small') style['caps'] = caps

  // `spc` is hundredths of a point, and negative is legal: letters can be drawn
  // closer together than the font asks for.
  const spacing = Number(attribute(properties, 'spc'))
  if (Number.isFinite(spacing)) style['letterSpacing'] = spacing / 100

  const color = literalColorOf(properties, 'a:solidFill')
  if (color !== null) style['color'] = color

  const highlight = literalColorOf(properties, 'a:highlight')
  if (highlight !== null) style['highlight'] = highlight

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

export interface DocOptions {
  /**
   * What a field says right now, given its type and the text the file cached.
   *
   * Asked for rather than worked out here: a slide number is the slide's place
   * in a deck, and a text body has no idea which deck it is in. Without it the
   * cached answer stands, which is what a notes page or a test wants.
   */
  field?: (type: string | null, cached: string) => string
}

/**
 * Reads a text body into a ProseMirror document.
 *
 * Walks the elements rather than the parsed model: each run's properties sit
 * beside it in the tree, and finding them any other way — by matching the text,
 * say — would hand two runs that read the same the same formatting.
 */
export function textBodyToDoc(body: TextBody, options: DocOptions = {}): PmNode {
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

        // A field is one thing, not the characters it happens to show: typing
        // over those characters is how a slide number stops being one.
        if (tag === 'a:fld') {
          const type = attribute(child, 'type') ?? null
          return [
            {
              type: 'ooxmlField',
              attrs: {
                xml: serializeNode(child),
                fieldType: type,
                text: options.field === undefined ? text : options.field(type, text),
              },
            },
          ]
        }

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
      const emu = (name: string) => {
        const value = Number(properties === undefined ? undefined : attribute(properties, name))
        return Number.isFinite(value) ? value : null
      }

      return {
        type: 'paragraph',
        attrs: {
          level: Number.isFinite(level) ? level : 0,
          align: (properties === undefined ? undefined : attribute(properties, 'algn')) ?? null,
          // `marL` is how far the whole paragraph is pushed in; `indent` is how
          // much further, or less far, the first line goes. Both in EMU, and
          // both absent far more often than present.
          marginLeft: emu('marL'),
          firstLine: emu('indent'),
          bullet: properties === undefined ? null : bulletKindOf(properties),
          lineSpacing: properties === undefined ? null : lineSpacingOf(properties),
          pPrOriginal: properties === undefined ? null : serializeNode(properties),
          // An empty paragraph carries its formatting here and nowhere else.
          endParaRPr: end === undefined ? null : serializeNode(end),
        },
        content,
      }
    })

  return { type: 'doc', content: paragraphs }
}

/** The paragraph-level bullet elements, in the order `a:pPr` wants them. */
const PARAGRAPH_PROPERTIES = [
  'a:lnSpc',
  'a:spcBef',
  'a:spcAft',
  'a:buClrTx',
  'a:buClr',
  'a:buSzTx',
  'a:buSzPct',
  'a:buSzPts',
  'a:buFontTx',
  'a:buFont',
  'a:buNone',
  'a:buAutoNum',
  'a:buChar',
  'a:buBlip',
  'a:tabLst',
  'a:defRPr',
  'a:extLst',
]

const BULLET_TAGS = ['a:buNone', 'a:buAutoNum', 'a:buChar', 'a:buBlip']

/** What kind of bullet a paragraph states, or null when it inherits one. */
function bulletKindOf(properties: XmlNode): string | null {
  for (const child of children(properties)) {
    switch (tagName(child)) {
      case 'a:buNone':
        return 'none'
      case 'a:buChar':
        return 'character'
      case 'a:buAutoNum':
        return 'number'
      case 'a:buBlip':
        return 'picture'
      default:
        continue
    }
  }
  return null
}

/** The line spacing as a multiple, or null for anything but a percentage. */
function lineSpacingOf(properties: XmlNode): number | null {
  const spacing = children(properties).find((child) => tagName(child) === 'a:lnSpc')
  if (spacing === undefined) return null

  const percent = children(spacing).find((child) => tagName(child) === 'a:spcPct')
  if (percent === undefined) return null

  const value = Number(attribute(percent, 'val'))
  return Number.isFinite(value) ? value / 100000 : null
}

/**
 * Writes the line spacing a paragraph was given.
 *
 * Only a multiple. An absolute spacing in points reads as null here — turning
 * it into a multiple would need the font size, which comes from a chain of six
 * places — so clearing the spacing removes the element only when it was a
 * percentage to begin with. Otherwise a paragraph spaced at exactly 18pt would
 * lose that the first time anything else about it was edited.
 */
function setLineSpacing(properties: XmlNode, multiple: unknown): void {
  const current = lineSpacingOf(properties)
  if (current === multiple) return

  if (typeof multiple !== 'number') {
    if (current !== null) removeChild(properties, 'a:lnSpc')
    return
  }

  removeChild(properties, 'a:lnSpc')
  upsertChild(
    properties,
    element('a:lnSpc', {}, [element('a:spcPct', { val: String(Math.round(multiple * 100000)) })]),
    PARAGRAPH_PROPERTIES,
  )
}

/**
 * Writes the bullet a paragraph was given.
 *
 * `null` means the paragraph says nothing and takes the level's — which is not
 * the same as `none`, where it says it has one and it is nothing. Removing the
 * elements for the first case is what puts the inherited bullet back.
 */
function setBullet(properties: XmlNode, kind: unknown): void {
  if (typeof kind !== 'string') return

  /**
   * Nothing is written when nothing changed.
   *
   * Rewriting the same bullet is not free: the file states `a:buChar` and this
   * would add the `a:buFont` beside it that PowerPoint writes but the original
   * did not. A body nobody edited has to come back byte for byte, and that is
   * what a round-trip test measures.
   */
  const already = bulletKindOf(properties)
  if (kind === already) return
  if (kind === 'inherit' && already === null) return

  for (const tag of BULLET_TAGS) removeChild(properties, tag)
  removeChild(properties, 'a:buFont')

  if (kind === 'inherit') return
  if (kind === 'none') {
    upsertChild(properties, element('a:buNone'), PARAGRAPH_PROPERTIES)
    return
  }
  if (kind === 'number') {
    upsertChild(properties, element('a:buAutoNum', { type: 'arabicPeriod' }), PARAGRAPH_PROPERTIES)
    return
  }
  if (kind === 'character') {
    // Arial carries the glyph on every platform we ship fonts for.
    upsertChild(properties, element('a:buFont', { typeface: 'Arial' }), PARAGRAPH_PROPERTIES)
    upsertChild(properties, element('a:buChar', { char: '\u2022' }), PARAGRAPH_PROPERTIES)
  }
}

/**
 * Writes a literal colour, or clears one the editor could carry and no longer
 * does.
 *
 * A theme colour never reached the mark, so it is never cleared by one: null
 * means "this run has no colour" only where the colour was a hex to begin with.
 * That asymmetry is the price of keeping `accent1` symbolic, and it is the
 * right way round — a run painted from the theme keeps following it.
 */
function setLiteralColor(properties: XmlNode, tag: string, value: unknown): void {
  if (typeof value === 'string') {
    const written = element(tag, {}, [
      element('a:srgbClr', { val: value.replace('#', '').toUpperCase() }),
    ])
    removeChild(properties, tag)
    upsertChild(properties, written, RUN_PROPERTIES)
    return
  }

  if (value === null && literalColorOf(properties, tag) !== null) removeChild(properties, tag)
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

  if (has('strike')) setAttribute(properties, 'strike', 'sngStrike')
  else removeAttribute(properties, 'strike')

  // The percentages PowerPoint itself writes for the two.
  if (has('superscript')) setAttribute(properties, 'baseline', '30000')
  else if (has('subscript')) setAttribute(properties, 'baseline', '-25000')
  else removeAttribute(properties, 'baseline')

  const style = marks.find((mark) => mark.type === 'textStyle')?.attrs
  const size = style?.['fontSize']
  if (typeof size === 'number') setAttribute(properties, 'sz', String(Math.round(size * 100)))

  const family = style?.['fontFamily']
  if (typeof family === 'string') {
    upsertChild(properties, element('a:latin', { typeface: family }), RUN_PROPERTIES)
  }

  /**
   * The attributes below are cleared when the mark says null and left alone
   * when it says nothing at all.
   *
   * Null is the editor stating that a run has none of this — which is what
   * clearing one looks like, and restoring it from the preserved properties
   * would be the edit that silently did not happen. Undefined is an editor that
   * does not model the attribute, and there the file's own answer stands.
   */
  const caps = style?.['caps']
  if (caps === 'all' || caps === 'small') setAttribute(properties, 'cap', caps)
  else if (caps === null) removeAttribute(properties, 'cap')

  const spacing = style?.['letterSpacing']
  if (typeof spacing === 'number')
    setAttribute(properties, 'spc', String(Math.round(spacing * 100)))
  else if (spacing === null) removeAttribute(properties, 'spc')

  setLiteralColor(properties, 'a:solidFill', style?.['color'])
  setLiteralColor(properties, 'a:highlight', style?.['highlight'])

  return properties
}

/** Rebuilds the `a:p` elements of a body from a document. */
export function docToParagraphs(doc: PmNode): XmlNode[] {
  return (doc.content ?? []).map((paragraph) => {
    const original = paragraph.attrs?.['pPrOriginal']
    const properties = typeof original === 'string' ? deserializeNode(original) : null

    /**
     * The properties the editor owns, patched onto the ones it does not.
     *
     * Without this the level and the alignment are read, edited and silently
     * not saved — the failure ADR 0002 names, and the reason every modelled
     * property needs a test that edits, saves and reads back rather than one
     * that only parses.
     */
    const level = Number(paragraph.attrs?.['level'] ?? 0)
    const align = paragraph.attrs?.['align']
    const bullet = paragraph.attrs?.['bullet']
    const marginLeft = paragraph.attrs?.['marginLeft']
    const firstLine = paragraph.attrs?.['firstLine']
    const patched =
      properties ??
      (level > 0 ||
      typeof align === 'string' ||
      typeof bullet === 'string' ||
      typeof marginLeft === 'number' ||
      typeof firstLine === 'number' ||
      typeof paragraph.attrs?.['lineSpacing'] === 'number'
        ? element('a:pPr')
        : null)

    if (patched !== null) {
      if (level > 0) setAttribute(patched, 'lvl', String(level))
      else removeAttribute(patched, 'lvl')

      if (typeof align === 'string') setAttribute(patched, 'algn', align)
      else removeAttribute(patched, 'algn')

      // Cleared rather than written as zero: zero is a stated answer, and a
      // paragraph that never said anything about its margin should go back to
      // inheriting one from its level.
      if (typeof marginLeft === 'number')
        setAttribute(patched, 'marL', String(Math.round(marginLeft)))
      else removeAttribute(patched, 'marL')

      if (typeof firstLine === 'number')
        setAttribute(patched, 'indent', String(Math.round(firstLine)))
      else removeAttribute(patched, 'indent')

      setBullet(patched, paragraph.attrs?.['bullet'])
      setLineSpacing(patched, paragraph.attrs?.['lineSpacing'])
    }

    const runs = (paragraph.content ?? []).flatMap((node): XmlNode[] => {
      if (node.type === 'hardBreak') return [element('a:br')]

      // Back exactly as it came, cached answer and all. What it shows is worked
      // out afresh every time it is drawn, so the cache is only what another
      // program reads before it does its own working out.
      if (node.type === 'ooxmlField') {
        const xml = node.attrs?.['xml']
        const original = typeof xml === 'string' && xml !== '' ? deserializeNode(xml) : null
        return original === null ? [] : [original]
      }

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
      ...(patched === null ? [] : [patched]),
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
