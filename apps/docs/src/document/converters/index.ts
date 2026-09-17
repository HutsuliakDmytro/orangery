import type { DocumentFormat } from '../formats'
import { htmlConverter } from './html'
import { markdownConverter } from './markdown'
import { rtfConverter } from './rtf'
import { textConverter } from './text'
import type { Converter } from './types'

export * from './html'
export * from './markdown'
export * from './odt'
export * from './rtf'
export * from './text'
export * from '@orangery/ui-kit'

/** Converters for the flat, text-based formats. DOCX and ODT are packages. */
const CONVERTERS: Partial<Record<DocumentFormat, Converter>> = {
  txt: textConverter,
  md: markdownConverter,
  html: htmlConverter,
  rtf: rtfConverter,
}

export function converterFor(format: DocumentFormat): Converter | null {
  return CONVERTERS[format] ?? null
}
