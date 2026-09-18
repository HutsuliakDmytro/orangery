/**
 * The text model a document and a slide share.
 *
 * WordprocessingML writes `w:p` holding `w:r`, DrawingML writes `a:p` holding
 * `a:r`, and the two describe the same thing: paragraphs of runs carrying
 * properties. These extensions model that, and nothing about where the text
 * sits — a page has columns, sections and headers, a slide has a box with a
 * position, and neither belongs here.
 */

export { PassthroughBlock, PassthroughInline, PreservedRunProperties } from './passthrough'
export type { PassthroughAttributes } from './passthrough'

export {
  clampFontSize,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_PRESETS,
  FontSize,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseFontSize,
} from './font-size'
export type { FontSizeOptions } from './font-size'

export { clampIndent, Indent, INDENT_STEP_PT, MAX_INDENT_PT } from './indent'
export type { IndentOptions } from './indent'

export {
  clampLineHeight,
  clampSpacing,
  DEFAULT_LINE_HEIGHT,
  LINE_HEIGHT_PRESETS,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
  ParagraphSpacing,
} from './paragraph-spacing'
export type { ParagraphSpacingOptions } from './paragraph-spacing'

export { clampLetterSpacing, MAX_LETTER_SPACING, MIN_LETTER_SPACING, RunStyle } from './run-style'
export type { Capitals, RunStyleOptions } from './run-style'

export { TabIndent } from './tab-indent'
export { PastePlainText, pastePlainTextKey } from './paste-plain-text'

export {
  ELLIPSIS,
  EM_DASH,
  NO_BREAK_SPACE,
  QUOTES,
  quoteLanguage,
  RIGHT_SINGLE_QUOTE,
  SmartTyping,
} from './smart-typing'
export type { QuoteLanguage, SmartTypingOptions } from './smart-typing'

export { OoxmlParagraph } from './ooxml-paragraph'
