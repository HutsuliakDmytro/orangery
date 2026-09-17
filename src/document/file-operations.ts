import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { isTauri } from '../platform/os'
import type { ProseMirrorNodeJson } from '../ooxml/parse-document'
import { DEFAULT_SECTION } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import type { HeadingNumberScheme } from '../editor/heading-numbers'
import type { Comment } from '../ooxml/comments'
import { converterFor } from './converters'
import { embedImagesInto, embedOdtImages } from './embed-images'
import { createNewOdt } from './odt-file'
import { naturalSize } from './media'
import { openOdt, saveOdt } from './converters/odt'
import type { OpenOdt } from './converters/odt'
import { createNewDocx, openDocx, saveDocx } from './docx-file'
import type { OpenDocx } from './docx-file'
import type { ParseWarning } from '../ooxml/parse-document'
import { formatFromPath, openFilters } from './formats'
import type { DocumentFormat } from './formats'

/**
 * File operations, bridging the OOXML layer to the OS.
 *
 * All disk access goes through Rust: writes have to be atomic and keep a backup,
 * which the webview cannot do (CLAUDE.md, "Documents are sacred").
 */

export interface LoadedDocument {
  bytes: number[]
  path: string
  modifiedMs: number | null
}

export interface SaveResult {
  path: string
  backupPath: string | null
  /** Anything the conversion could not carry across, for the warning banner. */
  warnings?: ParseWarning[]
}

export class UnsupportedFormatError extends Error {
  override readonly name = 'UnsupportedFormatError'
}

export async function pickOpenPath(): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: openFilters(),
  })

  return typeof selected === 'string' ? selected : null
}

export async function pickSavePath(suggestedName: string): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await saveDialog({
    defaultPath: suggestedName,
    filters: openFilters(),
  })

  return selected ?? null
}

export async function readDocumentFile(path: string): Promise<Uint8Array> {
  const loaded = await invoke<LoadedDocument>('read_document', { path })
  return new Uint8Array(loaded.bytes)
}

export async function writeDocumentFile(
  path: string,
  bytes: Uint8Array,
  keepBackup = true,
): Promise<SaveResult> {
  const result = await invoke<{ path: string; backup_path: string | null }>('write_document', {
    path,
    bytes: [...bytes],
    keepBackup,
  })

  return { path: result.path, backupPath: result.backup_path }
}

/**
 * The open document, in whichever shape its format needs.
 *
 * DOCX and ODT keep a package so their unmodelled parts survive a save; the flat
 * formats have nothing to preserve and carry only the text.
 */
export type OpenSession =
  | { kind: 'docx'; docx: OpenDocx }
  | { kind: 'odt'; odt: OpenOdt }
  | { kind: 'flat'; format: DocumentFormat }

export interface OpenedDocument {
  session: OpenSession
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
  path: string
  format: DocumentFormat
}

/**
 * Opens a file from disk. Only formats with a package behind them are supported
 * so far; the rest arrive in 2.3 and are rejected explicitly rather than opened
 * as garbage.
 */
export async function openDocumentFrom(path: string): Promise<OpenedDocument> {
  const format = formatFromPath(path)
  if (format === null) {
    throw new UnsupportedFormatError('Orangery Docs does not recognise this file type.')
  }

  const bytes = await readDocumentFile(path)

  if (format === 'docx') {
    const docx = await openDocx(bytes)
    return { session: { kind: 'docx', docx }, doc: docx.doc, warnings: docx.warnings, path, format }
  }

  if (format === 'odt') {
    const odt = await openOdt(bytes)
    return { session: { kind: 'odt', odt }, doc: odt.doc, warnings: odt.warnings, path, format }
  }

  const converter = converterFor(format)
  if (!converter) {
    throw new UnsupportedFormatError(`Opening ${format.toUpperCase()} files is not supported yet.`)
  }

  const { doc, warnings } = converter.parse(new TextDecoder().decode(bytes))
  return { session: { kind: 'flat', format }, doc, warnings, path, format }
}

/** What the editing session knows that the document body does not carry. */
export interface SaveOptions {
  section?: SectionProperties
  headingNumbering?: HeadingNumberScheme | null
  comments?: ReadonlyMap<number, Comment>
  trackChanges?: boolean
}

export async function saveDocumentTo(
  session: OpenSession,
  doc: ProseMirrorNodeJson,
  path: string,
  options: SaveOptions = {},
): Promise<SaveResult> {
  const format = formatFromPath(path)
  if (format === null) {
    throw new UnsupportedFormatError('Saving as this file type is not supported.')
  }

  // Saving a DOCX as DOCX writes the preserved package back. Saving it as
  // anything else is a conversion, and the package is left behind — the format
  // list marks which targets preserve and which do not.
  if (format === 'docx') {
    if (session.kind === 'docx') {
      return writeDocumentFile(path, await saveDocx(session.docx, doc, options))
    }

    // Converting into the native format. The document starts from the template
    // a new file would use, and the pictures have to be moved into it before
    // the body is written, or the drawings point at nothing.
    const fresh = await createNewDocx()
    const embedded = await embedImagesInto(fresh.pkg, doc, {
      section: options.section ?? fresh.section,
      measure: naturalSize,
    })

    const result = await writeDocumentFile(path, await saveDocx(fresh, embedded.doc, options))
    return embedded.warnings.length > 0 ? { ...result, warnings: embedded.warnings } : result
  }

  if (format === 'odt') {
    if (session.kind === 'odt') {
      return writeDocumentFile(path, await saveOdt(session.odt, doc))
    }

    const fresh = await createNewOdt()
    const embedded = await embedOdtImages(fresh.pkg, doc, {
      section: options.section ?? DEFAULT_SECTION,
      measure: naturalSize,
    })

    const result = await writeDocumentFile(path, await saveOdt(fresh, embedded.doc))
    return embedded.warnings.length > 0 ? { ...result, warnings: embedded.warnings } : result
  }

  const converter = converterFor(format)
  if (!converter) {
    throw new UnsupportedFormatError(
      `Saving to ${format.toUpperCase()} from this document is not supported yet.`,
    )
  }

  return writeDocumentFile(path, new TextEncoder().encode(converter.serialize(doc)))
}

export function createDocument(): Promise<OpenDocx> {
  return createNewDocx()
}

/** Adds the format's extension when the user typed a bare name in Save As. */
export function ensureExtension(path: string, format: DocumentFormat): string {
  return formatFromPath(path) === null ? `${path}.${format}` : path
}
