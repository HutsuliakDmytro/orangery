import { findChild } from '@orangery/ooxml-core'
import { readListStyle } from '@orangery/ooxml-drawingml'
import type { ListStyle, ParagraphProperties, RunProperties } from '@orangery/ooxml-drawingml'
import { layoutOf, masterOf } from './deck'
import type { Deck, Master, Slide } from './deck'
import { findInLayout, findInMaster, masterKindOf } from './placeholders'
import type { Shape } from './shape-tree'

/**
 * Where a paragraph's properties actually come from.
 *
 * A paragraph in a deck typically states its outline level and nothing else.
 * Its size, colour, bullet and indent come from a chain that has to be walked
 * in order, taking the first level that states each property:
 *
 *   1. the paragraph's own `a:pPr`
 *   2. the shape's `a:lstStyle`
 *   3. the layout placeholder's `a:lstStyle`
 *   4. the master placeholder's `a:lstStyle`
 *   5. the master's `p:txStyles`, in the flavour that matches the placeholder
 *   6. the presentation's `p:defaultTextStyle`
 *
 * Step 5 is the one that carries almost everything in practice, and it is not
 * where the other steps are: a master keeps its text styles in `p:txStyles`
 * beside the shape tree, not on the placeholder shapes, and keeps three of them
 * — title, body and everything else — chosen by what the placeholder is.
 *
 * Properties merge field by field. A paragraph that sets only its alignment
 * keeps the inherited bullet, which is what makes a deck's outline look
 * consistent while each level styles itself.
 */

export interface MasterTextStyles {
  title: ListStyle
  body: ListStyle
  other: ListStyle
}

const EMPTY_STYLE: ListStyle = new Map()

/** Reads `p:txStyles` from a master. */
export function readMasterTextStyles(master: Master): MasterTextStyles {
  const styles = findChild(master.root, 'p:txStyles')
  const read = (tag: string): ListStyle => {
    const element = styles === undefined ? undefined : findChild(styles, tag)
    return element === undefined ? EMPTY_STYLE : readListStyle(element)
  }

  return {
    title: read('p:titleStyle'),
    body: read('p:bodyStyle'),
    other: read('p:otherStyle'),
  }
}

/**
 * Which of the master's three a placeholder takes.
 *
 * Title and centre title take the title style; anything that holds content
 * takes the body style; the date, footer and slide number take `otherStyle`,
 * as does a shape that is not a placeholder at all.
 */
export function masterStyleFor(styles: MasterTextStyles, shape: Shape): ListStyle {
  if (shape.placeholder === null) return styles.other

  switch (masterKindOf(shape.placeholder.type)) {
    case 'title':
      return styles.title
    case 'body':
      return styles.body
    default:
      return styles.other
  }
}

/**
 * The list styles that apply to a shape, nearest first.
 *
 * `defaultTextStyle` comes last and is what a plain text box falls back to,
 * since it belongs to no placeholder and so inherits nothing from the layout.
 */
export function listStyleChain(deck: Deck, slide: Slide, shape: Shape): ListStyle[] {
  const chain: ListStyle[] = []
  if (shape.text !== null) chain.push(shape.text.listStyle)

  const layout = layoutOf(deck, slide)
  const master = layout === null ? null : masterOf(deck, layout)

  if (shape.placeholder !== null && layout !== null) {
    const onLayout = findInLayout(layout, shape.placeholder)
    if (onLayout?.text != null) chain.push(onLayout.text.listStyle)

    if (master !== null) {
      const type = onLayout?.placeholder?.type ?? shape.placeholder.type
      const onMaster = findInMaster(master, { type, index: null })
      if (onMaster?.text != null) chain.push(onMaster.text.listStyle)
    }
  }

  if (master !== null) chain.push(masterStyleFor(readMasterTextStyles(master), shape))
  chain.push(deck.defaultTextStyle)

  return chain
}

/** Takes the first stated value for each field, nearest level first. */
function mergeRunProperties(levels: readonly (RunProperties | null)[]): RunProperties | null {
  const stated = levels.filter((level): level is RunProperties => level !== null)
  if (stated.length === 0) return null

  const first = <K extends keyof RunProperties>(key: K): RunProperties[K] => {
    for (const level of stated) {
      if (level[key] !== null) return level[key]
    }
    return stated[0]?.[key] ?? null
  }

  return {
    size: first('size'),
    bold: first('bold'),
    italic: first('italic'),
    underline: first('underline'),
    strike: first('strike'),
    color: first('color'),
    font: first('font'),
    spacing: first('spacing'),
    caps: first('caps'),
    baseline: first('baseline'),
    hyperlink: first('hyperlink'),
  }
}

/**
 * The properties a paragraph is actually laid out with.
 *
 * `own` is the paragraph's own `a:pPr`; the chain is everything behind it. The
 * level comes from the paragraph and selects the same rung on every list style
 * in the chain.
 */
export function resolveParagraphProperties(
  own: ParagraphProperties,
  chain: readonly ListStyle[],
): ParagraphProperties {
  const levels = [own, ...chain.flatMap((style) => style.get(own.level) ?? [])]

  const first = <K extends keyof ParagraphProperties>(key: K): ParagraphProperties[K] => {
    for (const level of levels) {
      if (level[key] !== null) return level[key]
    }
    return null as ParagraphProperties[K]
  }

  return {
    level: own.level,
    align: first('align'),
    marginLeft: first('marginLeft'),
    indent: first('indent'),
    bullet: first('bullet'),
    lineSpacing: first('lineSpacing'),
    spaceBefore: first('spaceBefore'),
    spaceAfter: first('spaceAfter'),
    defaultRunProperties: mergeRunProperties(levels.map((level) => level.defaultRunProperties)),
  }
}

/**
 * The properties a run is actually drawn with: its own, then the resolved
 * paragraph defaults behind it.
 */
export function resolveRunProperties(
  own: RunProperties | null,
  paragraph: ParagraphProperties,
): RunProperties | null {
  return mergeRunProperties([own, paragraph.defaultRunProperties])
}
