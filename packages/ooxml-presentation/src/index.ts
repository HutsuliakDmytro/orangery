/**
 * PresentationML — the `p:*` parts of a deck.
 *
 * What is here is the shape of the package: which parts exist, what order the
 * slides are in, which layout each slide is built on. Drawing the shapes on a
 * slide is DrawingML and lives in `@orangery/ooxml-drawingml`; the zip itself
 * is `@orangery/ooxml-core`.
 */

export {
  HANDOUT_MASTER_RELATIONSHIP,
  NOTES_MASTER_RELATIONSHIP,
  NOTES_SLIDE_RELATIONSHIP,
  PRES_PROPS_PART,
  PRESENTATION_PART,
  PRESENTATION_RELS_PART,
  readPptxPackage,
  SLIDE_LAYOUT_RELATIONSHIP,
  SLIDE_MASTER_RELATIONSHIP,
  SLIDE_RELATIONSHIP,
  TABLE_STYLES_PART,
  THEME_RELATIONSHIP,
  VIEW_PROPS_PART,
} from './parts'

export { readPresentation, referencedParts } from './presentation'
export { layoutOf, masterOf, readDeck, readSlidePart } from './deck'
export type { Deck, Master, Slide, SlidePart } from './deck'
export { flatten, parseShapeTree } from './shape-tree'
export type { Placeholder, Shape, ShapeKind, Transform } from './shape-tree'
export type { MasterParts, PresentationMap, SlideParts, SlideSize } from './presentation'
export { declarationOf, rewriteEveryPart, saveDeck, writePart, writeSlidePart } from './save'
export {
  findInLayout,
  findInMaster,
  inheritanceChain,
  masterKindOf,
  resolveTransform,
} from './placeholders'
export type { MasterPlaceholder } from './placeholders'
export { colorContextFor, readColorMap, readThemes } from './theme-context'
