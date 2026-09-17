/**
 * Formats the app can open and save.
 *
 * DOCX is the native one — Save writes DOCX and there is no app-specific format
 * (CLAUDE.md). The others are conversions: opening one produces a document whose
 * "Save" target is still itself, but round-trip preservation only holds for DOCX,
 * because only DOCX carries a package to preserve.
 */

export type DocumentFormat = 'docx' | 'odt' | 'rtf' | 'txt' | 'md' | 'html'

export interface FormatDefinition {
  format: DocumentFormat
  label: string
  extensions: string[]
  /** Whether the whole original package is preserved across a save. */
  preserving: boolean
}

export const FORMATS: readonly FormatDefinition[] = [
  { format: 'docx', label: 'Word Document', extensions: ['docx'], preserving: true },
  { format: 'odt', label: 'OpenDocument Text', extensions: ['odt'], preserving: true },
  { format: 'rtf', label: 'Rich Text Format', extensions: ['rtf'], preserving: false },
  { format: 'txt', label: 'Plain Text', extensions: ['txt'], preserving: false },
  { format: 'md', label: 'Markdown', extensions: ['md', 'markdown'], preserving: false },
  { format: 'html', label: 'Web Page', extensions: ['html', 'htm'], preserving: false },
]

export const DEFAULT_FORMAT: DocumentFormat = 'docx'

export function formatFromPath(path: string): DocumentFormat | null {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === undefined || extension === path.toLowerCase()) return null

  return FORMATS.find((entry) => entry.extensions.includes(extension))?.format ?? null
}

export function definitionOf(format: DocumentFormat): FormatDefinition {
  const definition = FORMATS.find((entry) => entry.format === format)
  if (!definition) throw new Error(`unknown format: ${format}`)
  return definition
}

export function isPreserving(format: DocumentFormat): boolean {
  return definitionOf(format).preserving
}

/** Filters for the system open dialog, most useful first. */
export function openFilters(): { name: string; extensions: string[] }[] {
  return [
    { name: 'All Documents', extensions: FORMATS.flatMap((entry) => entry.extensions) },
    ...FORMATS.map((entry) => ({ name: entry.label, extensions: entry.extensions })),
  ]
}

/** The file name a new document gets before it has been saved anywhere. */
export const UNTITLED_NAME = 'Untitled document'

export function fileNameOf(path: string | null): string {
  if (path === null) return UNTITLED_NAME
  const name = path.split(/[\\/]/u).pop()
  return name === undefined || name === '' ? UNTITLED_NAME : name
}

/** Strips the extension, for the window title. */
export function displayNameOf(path: string | null): string {
  const name = fileNameOf(path)
  return name.replace(/\.[^.]+$/u, '')
}
