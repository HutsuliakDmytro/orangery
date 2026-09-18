/**
 * DrawingML — the markup a document and a deck have in common.
 *
 * `a:*` and `pic:*` describe shapes, pictures and their geometry the same way
 * everywhere. The wrappers that place them differ per format: `wp:inline` and
 * `wp:anchor` belong to WordprocessingML, `p:sp` and `p:spTree` to
 * presentations, and neither belongs here.
 */

export {
  EMU_PER_CENTIMETRE,
  EMU_PER_INCH,
  EMU_PER_POINT,
  emuToPoints,
  fitWithin,
  pointsToEmu,
} from './units'
export { contentTypeFor } from './media'
export { blipRelationshipId, NO_CROP, pictureGraphic, readBlipFill } from './picture'
export type { BlipFill, Crop, Picture } from './picture'
export { readColor, readColorChild, resolveColor } from './color'
export type { Color, ColorContext, ColorSource, ColorTransform, ResolvedColor } from './color'
export { hasAnyEffect, readShadow, shadowOffset } from './effects'
export type { Shadow } from './effects'
export { imageSize } from './image-size'
export type { ImageSize } from './image-size'
export { fontStackFor, parseTheme, resolveThemeFont } from './theme'
export type { Theme, ThemeFonts } from './theme'
export {
  hasEffects,
  readFill,
  readLine,
  readShapeProperties,
  readShapeStyle,
} from './shape-properties'
export type {
  Arrow,
  Fill,
  Geometry,
  GradientStop,
  Line,
  LineCap,
  ShapeProperties,
  ShapeStyle,
  StyleReference,
} from './shape-properties'
export {
  readBodyProperties,
  readListStyle,
  readParagraph,
  readParagraphProperties,
  readRunProperties,
  readTextBody,
  textOfBody,
} from './text-body'
export type {
  Autofit,
  BodyProperties,
  Bullet,
  ListStyle,
  ParagraphProperties,
  RunProperties,
  Spacing,
  TextBody,
  TextParagraph,
  TextRun,
} from './text-body'
export {
  EMPTY_FORMAT_SCHEME,
  fillForReference,
  lineForReference,
  readFormatScheme,
} from './format-scheme'
export type { FormatScheme } from './format-scheme'
export { readCellProperties, readTable, visibleCells } from './table'
export type { CellProperties, Table, TableCell, TableProperties, TableRow } from './table'
export { readChart } from './chart'
export type { Chart, ChartKind, ChartSeries } from './chart'
export { docToParagraphs, textBodyToDoc, writeTextBody } from './text-prosemirror'
export type { PmMark, PmNode } from './text-prosemirror'
export { autofitKindOf, bodyPropertiesOf, writeBodyProperties } from './write-text-body'
export type { Anchor, AutofitKind, BodyChange, Wrap } from './write-text-body'
export {
  customGeometry,
  parseSvgPath,
  readCustomGeometry,
  toSvgPath,
  UnsupportedPathError,
} from './svg-path'
export type { CustomPath, PathSegment, Point } from './svg-path'
