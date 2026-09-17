import type { Placeholder, Shape, Transform } from './shape-tree'
import { flatten } from './shape-tree'
import { layoutOf, masterOf } from './deck'
import type { Deck, Slide, SlidePart } from './deck'

/**
 * Placeholder inheritance: slide → layout → master.
 *
 * A title on a slide usually states nothing but its text. Its position, size,
 * font and bullet style come from the layout's title, and the layout's title
 * often states nothing either — it comes from the master's. Three levels, each
 * able to override any part of the one above.
 *
 * The two steps do not match the same way, and that is the trap:
 *
 *   **slide → layout matches on `idx`.** A layout can hold several body
 *   placeholders and the slide says which one it is filling.
 *
 *   **layout → master matches on type.** The indices are unrelated between the
 *   two — in PowerPoint's own default master the date placeholder is `idx="2"`
 *   while the layout's is `idx="10"`. Matching those on `idx` finds nothing,
 *   and a resolver that then falls back to "the first placeholder" would hand
 *   the date the title's geometry.
 *
 * A master holds only five kinds. Everything a layout can offer collapses into
 * one of them, which is what makes the second step a mapping rather than a
 * lookup.
 */

/** The five placeholder kinds a slide master defines. */
export type MasterPlaceholder = 'title' | 'body' | 'dt' | 'ftr' | 'sldNum'

const MASTER_KIND: Readonly<Record<string, MasterPlaceholder>> = {
  title: 'title',
  ctrTitle: 'title',
  dt: 'dt',
  ftr: 'ftr',
  sldNum: 'sldNum',
}

/**
 * Which of the master's five a layout placeholder inherits from.
 *
 * Everything that holds content — body, object, picture, table, chart, diagram,
 * media, subtitle — comes from the master's body. That is not a simplification:
 * the master has nothing else for them to come from.
 */
export function masterKindOf(type: string): MasterPlaceholder {
  return MASTER_KIND[type] ?? 'body'
}

/** `idx` is optional and means 0 when absent, which is how PowerPoint reads it. */
const indexOf = (placeholder: Placeholder): number => placeholder.index ?? 0

const placeholders = (part: SlidePart): Shape[] =>
  flatten(part.shapes).filter((shape) => shape.placeholder !== null)

/**
 * The layout shape a slide shape is filling.
 *
 * Index first; type only as a fallback, for the malformed decks where a slide
 * names an index the layout does not have.
 */
export function findInLayout(layout: SlidePart, placeholder: Placeholder): Shape | null {
  const candidates = placeholders(layout)
  const wanted = indexOf(placeholder)

  const byIndex = candidates.find(
    (shape) => shape.placeholder !== null && indexOf(shape.placeholder) === wanted,
  )
  if (byIndex !== undefined) return byIndex

  return (
    candidates.find(
      (shape) =>
        shape.placeholder !== null &&
        masterKindOf(shape.placeholder.type) === masterKindOf(placeholder.type),
    ) ?? null
  )
}

/** The master shape a layout shape inherits from, matched on kind alone. */
export function findInMaster(master: SlidePart, placeholder: Placeholder): Shape | null {
  const kind = masterKindOf(placeholder.type)

  return (
    placeholders(master).find(
      (shape) => shape.placeholder !== null && masterKindOf(shape.placeholder.type) === kind,
    ) ?? null
  )
}

/**
 * The shapes a slide shape inherits from, nearest first.
 *
 * Starts with the shape itself, so reading a property is "the first level that
 * states it" rather than a special case for each level.
 */
export function inheritanceChain(deck: Deck, slide: Slide, shape: Shape): Shape[] {
  const chain = [shape]
  if (shape.placeholder === null) return chain

  const layout = layoutOf(deck, slide)
  if (layout === null) return chain

  const onLayout = findInLayout(layout, shape.placeholder)
  if (onLayout !== null) chain.push(onLayout)

  const master = masterOf(deck, layout)
  if (master === null) return chain

  // Matched against what the layout says it is, falling back to the slide's own
  // type when the layout has nothing for it.
  const type = onLayout?.placeholder?.type ?? shape.placeholder.type
  const onMaster = findInMaster(master, { type, index: null })
  if (onMaster !== null) chain.push(onMaster)

  return chain
}

/**
 * Where a shape actually sits.
 *
 * Resolved at read time and never written back: baking the inherited geometry
 * into the slide would look identical and detach the shape from its layout, so
 * the next theme or layout change would skip it (ADR 0002).
 */
export function resolveTransform(deck: Deck, slide: Slide, shape: Shape): Transform | null {
  for (const level of inheritanceChain(deck, slide, shape)) {
    if (level.transform !== null) return level.transform
  }
  return null
}
