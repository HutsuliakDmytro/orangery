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

export { createDeck } from './create-deck'
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
export { colorContextFor, readColorMap, readThemes, themeFor } from './theme-context'
export { buildThemeFile } from './theme-file'
export { hiddenUntilAnimated, readAnimations } from './animations'
export { addEffect, moveStep, removeEffect, setEffectTiming } from './write-animations'
export {
  cellsOf,
  patchedWorkbook,
  patchedWorkbookRows,
  writeChartCache,
  writeChartCategories,
  writeChartPoints,
} from './chart-data'
export type { ChartCategories, ChartValues } from './chart-data'
export { applicable, applyChange, compareDecks, describeChange } from './compare'
export type { Change, ShapeChange } from './compare'
export {
  addComment,
  hasComments,
  readCommentAuthors,
  readComments,
  removeComment,
} from './comments'
export type { Comment, CommentAuthor, NewComment } from './comments'
export { addInkStroke } from './ink'
export { addNarration } from './narration'
export type { Narration } from './narration'
export type { InkStroke } from './ink'
export { creationIdOf, matchShapes, morphOrigins } from './morph'
export type { MorphPair } from './morph'
export type { EffectChange, EffectName, NewEffect } from './write-animations'
export type { AnimationStep, Effect, EffectKind, Trigger } from './animations'
export { readEmbeddedFonts } from './embedded-fonts'
export type { EmbeddedFace, EmbeddedFont, FontStyle } from './embedded-fonts'
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
export { absoluteTransform, intoGroupSpace, throughGroup, withAncestors } from './group-transform'
export type { Connection } from './shape-tree'
export { readGraphicContent } from './graphic-frame'
export { convertDiagramToShapes, diagramDrawingPart, readDiagramShapes } from './diagram'
export type { GraphicContent, GraphicKind } from './graphic-frame'
export { backgroundOf, readBackground } from './background'
export type { Background } from './background'
export {
  ensureTextBody,
  moveShape,
  replacePicture,
  writeCrop,
  writePictureOpacity,
  writeTransform,
} from './write-shape'
export { setShapeText } from './write-text'
export { applyShapeFormat, copyShapeFormat } from './format-painter'
export type { ShapeFormat } from './format-painter'
export { DEFAULT_DATE_FIELD, fieldValue, isDateField, slideNumberOf } from './fields'
export type { FieldContext } from './fields'
export { applyFooters, NO_FOOTERS, readFooters } from './footers'
export type { FooterKind, FooterOptions, FooterSettings } from './footers'
export type { TextLine } from './write-text'
export { reorderShapes } from './z-order'
export {
  alignmentBounds,
  alignShapes,
  distributeShapes,
  duplicateShape,
  flipShapes,
  nextShapeId,
  offsetShape,
} from './arrange'
export type { Alignment } from './arrange'
export { groupShapes, ungroupShape } from './group'
export { writeFill, writeLine, writeShadow } from './write-look'
export type { LineChange } from './write-look'
export {
  CLIPBOARD_KIND,
  clipboardText,
  copyShapes,
  parseClipboard,
  pasteShapes,
  themeSnapshot,
} from './clipboard'
export type {
  ClipboardMedia,
  ClipboardShapes,
  ClipboardTheme,
  PasteFormatting,
  PasteOptions,
} from './clipboard'
export { createShape, deleteShapes } from './create-shape'
export {
  addGeometryPoint,
  geometryPoints,
  moveGeometryPoint,
  pathIsClosed,
  pathSpace,
  removeGeometryPoint,
} from './geometry-points'
export type { GeometryPoint } from './geometry-points'
export type { NewShape } from './create-shape'
export { insertPicture, relsPartFor, UnsupportedPictureError } from './insert-picture'
export type { NewPicture } from './insert-picture'
export { defaultTableStyle, insertTable } from './insert-table'
export { builtInApproximation, partsFor, readTableStyles, styleFor } from './table-styles'
export type { TablePart, TableStyle } from './table-styles'
export {
  columnCount,
  insertColumn,
  insertRow,
  mergeCells,
  removeColumn,
  removeRow,
  rowCount,
  splitCell,
} from './table-edit'
export type { CellRange } from './table-edit'
export type { NewTable } from './insert-table'
export { connectorEnds, moveConnectorEnd, nearestSite, sitePoint } from './connect'
export type { ConnectorEnd, EndMove } from './connect'
export { facingSites, insertConnector, SITES } from './insert-connector'
export type { NewConnector, Site } from './insert-connector'
export { findInDeck, replaceInDeck, replaceInSlide, replaceMatch } from './find-replace'
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
export {
  addGuide,
  DEFAULT_GRID,
  MAX_GRID,
  MIN_GRID,
  moveGuide,
  readGridSpacing,
  readGuides,
  removeGuide,
  writeGridSpacing,
  writeGuides,
} from './guides'
export type { SlideGuide } from './guides'
export { insertIcon } from './insert-icon'
export type { NewIcon } from './insert-icon'
export { readTransition, setAdvanceTime } from './transition'
export type { Transition, TransitionDirection, TransitionKind } from './transition'
export type { Media } from './shape-tree'
export { autoplayShapes } from './media-timing'
export { resolveHyperlink } from './hyperlink'
export type { Hyperlink } from './hyperlink'
export { readLinkTarget } from './shape-tree'
export type { LinkTarget } from './shape-tree'
