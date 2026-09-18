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

export { readPresentation, referencedParts, relationshipTarget } from './presentation'
export { layoutOf, masterOf, readDeck, readSlidePart, slideName } from './deck'
export type { Deck, Master, Slide, SlidePart } from './deck'
export { flatten, parseShape, parseShapeTree } from './shape-tree'
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
export {
  listStyleChain,
  masterStyleFor,
  readMasterTextStyles,
  resolveParagraphProperties,
  resolveRunProperties,
} from './text-inheritance'
export type { MasterTextStyles } from './text-inheritance'
export { lookContext, shapeLook } from './shape-look'
export type { ShapeLook } from './shape-look'
export { absoluteTransform, throughGroup, withAncestors } from './group-transform'
export type { Connection } from './shape-tree'
export { readGraphicContent } from './graphic-frame'
export type { GraphicContent, GraphicKind } from './graphic-frame'
export { backgroundOf, readBackground } from './background'
export type { Background } from './background'
export { ensureTextBody, moveShape, writeTransform } from './write-shape'
export { reorderShapes } from './z-order'
export {
  alignmentBounds,
  alignShapes,
  distributeShapes,
  duplicateShape,
  nextShapeId,
  offsetShape,
} from './arrange'
export type { Alignment } from './arrange'
export { groupShapes, ungroupShape } from './group'
export { writeFill, writeLine } from './write-look'
export type { LineChange } from './write-look'
export { createShape, deleteShapes } from './create-shape'
export type { NewShape } from './create-shape'
export { insertPicture, relsPartFor, UnsupportedPictureError } from './insert-picture'
export type { NewPicture } from './insert-picture'
export { defaultTableStyle, insertTable } from './insert-table'
export type { NewTable } from './insert-table'
export { facingSites, insertConnector, SITES } from './insert-connector'
export type { NewConnector, Site } from './insert-connector'
export { findInDeck, replaceInDeck, replaceInSlide } from './find-replace'
export type { Match, SearchOptions } from './find-replace'
export {
  addSlide,
  duplicateSlide,
  duplicateSlides,
  moveSlide,
  moveSlides,
  removeSlide,
  removeSlides,
  setSlideLayout,
} from './add-slide'
export type { AddedSlide } from './add-slide'
export {
  addSection,
  readSections,
  removeSection,
  renameSection,
  sectionOfSlide,
  slidesOfSection,
  syncSections,
  writeSections,
} from './sections'
export type { Section } from './sections'
export {
  masterShapesShown,
  showMasterShapes,
  writeBackground,
  writeBackgroundPicture,
} from './write-background'
export { setSlideSize, SLIDE_SIZE_PRESETS } from './slide-size'
export type { ContentFit } from './slide-size'
export { setThemeColors, setThemeFonts, setThemeName } from './write-theme'
export type { ColorSlot, ThemeFontChange } from './write-theme'
export { applyTheme, THEME_GALLERY, themePathsOf } from './theme-gallery'
export type { GalleryTheme } from './theme-gallery'
export { addGuide, moveGuide, readGuides, removeGuide, writeGuides } from './guides'
export type { SlideGuide } from './guides'
export { insertIcon } from './insert-icon'
export type { NewIcon } from './insert-icon'
