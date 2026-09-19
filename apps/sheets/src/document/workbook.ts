import { parseRelationships, partDirectory, readPackage, resolveTarget } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import {
  drawingRelationshipId,
  paletteOf,
  readSharedStrings,
  readSheetComments,
  readSheetData,
  readSheetDrawings,
  readStyles,
  readWorkbook,
  readWorksheet,
} from '@orangery/ooxml-spreadsheet'
import type {
  SheetCells,
  SheetComments,
  SheetDrawing,
  Styles,
  Workbook,
  Worksheet,
} from '@orangery/ooxml-spreadsheet'
import type { ColorPalette } from '@orangery/ooxml-spreadsheet'
import { parseTheme } from '@orangery/ooxml-drawingml'
import { getPartText } from '@orangery/ooxml-core'

/**
 * A workbook, opened.
 *
 * Everything the window needs in one place and nothing computed that a cell
 * might never be looked at: the cells are read because they are what a sheet
 * is, and the styles are read because every cell points into them, but a
 * cell's colour and its text are worked out when it is drawn.
 *
 * The package is kept as it was read. Saving rewrites the parts we model and
 * leaves the rest byte for byte, which is the promise the round-trip ADR makes
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`).
 */

/** A drawing on a sheet, with the part it points at found in the package. */
export interface AnchoredDrawing {
  drawing: SheetDrawing
  /**
   * The chart part or the image, as a path into the package.
   *
   * Resolved on open because it takes two relationship files to find — the
   * sheet's, then the drawing's — and null where either is missing, which is
   * a file that refers to something it does not carry.
   */
  path: string | null
}

export interface OpenSheet {
  name: string
  path: string
  /** `hidden` and `veryHidden` sheets are in the file and not in the tabs. */
  hidden: boolean
  sheet: Worksheet
  cells: SheetCells
  /** Charts and pictures, which sit on the sheet rather than in a cell. */
  drawings: AnchoredDrawing[]
  /** What has been said about its cells: threads, and the older notes. */
  comments: SheetComments
}

export interface OpenWorkbook {
  pkg: OoxmlPackage
  workbook: Workbook
  sheets: OpenSheet[]
  styles: Styles | null
  /** The shared string table, which most text cells are an index into. */
  strings: string[]
  palette: ColorPalette
}

const THEME_PART = 'xl/theme/theme1.xml'

export async function openWorkbook(bytes: Uint8Array): Promise<OpenWorkbook> {
  // The part that must be there: a zip without it is not a workbook, and
  // failing here says so rather than three layers deeper.
  const pkg = await readPackage(bytes, 'xl/workbook.xml')
  const workbook = readWorkbook(pkg)

  const theme = parseTheme(getPartText(pkg, THEME_PART) ?? '')
  const palette = paletteOf(
    { colors: new Map([...theme.colors].map(([slot, color]) => [slot, colorHex(color)])) },
    // What the system's own foreground and background are, which is what the
    // 1997 palette's last two indexes mean.
    { foreground: '000000', background: 'FFFFFF' },
  )

  const sheets = (workbook?.sheets ?? []).map((entry) => {
    const text = getPartText(pkg, entry.path) ?? ''

    return {
      name: entry.name,
      path: entry.path,
      hidden: entry.state !== 'visible',
      sheet: readWorksheet(text) ?? EMPTY_SHEET,
      cells: readSheetData(text),
      drawings: drawingsOf(pkg, entry.path, text),
      comments: commentsOf(pkg, entry.path),
    }
  })

  return {
    pkg,
    workbook: workbook ?? {
      sheets: [],
      date1904: false,
      definedNames: [],
      activeSheet: 0,
      fullCalcOnLoad: false,
    },
    sheets,
    styles: readStyles(getPartText(pkg, 'xl/styles.xml') ?? ''),
    strings: readSharedStrings(pkg),
    palette,
  }
}

/** Where a part keeps its relationships, which is beside it and under `_rels`. */
const relationshipsOf = (path: string): string => {
  const directory = partDirectory(path)
  const name = path.slice(directory.length + 1)
  return `${directory}/_rels/${name}.rels`
}

/**
 * The drawings on a sheet, and what each one points at.
 *
 * Two hops. The sheet names a drawing part by relationship id; the drawing
 * part names a chart or an image the same way. Neither hop is a path — a
 * relationship target is relative to the part that states it — which is why
 * this is done here rather than guessed at from a file name.
 */
function drawingsOf(pkg: OoxmlPackage, sheetPath: string, sheetXml: string): AnchoredDrawing[] {
  const id = drawingRelationshipId(sheetXml)
  if (id === null) return []

  const sheetRelationships = parseRelationships(getPartText(pkg, relationshipsOf(sheetPath)) ?? '')
  const target = sheetRelationships.get(id)?.target
  if (target === undefined) return []

  const path = resolveTarget(target, partDirectory(sheetPath))
  const xml = getPartText(pkg, path)
  if (xml === undefined) return []

  const relationships = parseRelationships(getPartText(pkg, relationshipsOf(path)) ?? '')
  const directory = partDirectory(path)

  return readSheetDrawings(xml).map((drawing) => {
    const content = drawing.content
    const to =
      content.kind === 'other' ? undefined : relationships.get(content.relationshipId)?.target

    return { drawing, path: to === undefined ? null : resolveTarget(to, directory) }
  })
}

const NOTES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const THREADS_RELATIONSHIP =
  'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment'

/**
 * The comment parts of one sheet, found through its relationships.
 *
 * Both kinds, because Excel writes both: a thread for itself and a note for
 * readers older than 2018. Which of them to show is the renderer's decision,
 * and it can only make it if it has been given both.
 */
function commentsOf(pkg: OoxmlPackage, sheetPath: string): SheetComments {
  const relationships = parseRelationships(getPartText(pkg, relationshipsOf(sheetPath)) ?? '')
  const directory = partDirectory(sheetPath)

  const partOf = (type: string) => {
    const target = [...relationships.values()].find((one) => one.type === type)?.target
    return target === undefined ? null : resolveTarget(target, directory)
  }

  return readSheetComments(pkg, partOf(NOTES_RELATIONSHIP), partOf(THREADS_RELATIONSHIP))
}

/** A theme colour as six hex digits, which is all the palette needs of it. */
function colorHex(color: {
  source: { kind: string; hex?: string; lastHex?: string | null }
}): string {
  if (color.source.kind === 'srgb' && typeof color.source.hex === 'string') {
    return color.source.hex.replace(/^#/u, '')
  }

  // A system colour states what the host computed last; anything else the
  // theme cannot resolve on its own is left black, which is what Excel shows
  // for a slot it cannot find either.
  return (color.source.lastHex ?? '000000').replace(/^#/u, '')
}

const EMPTY_SHEET: Worksheet = {
  dimension: null,
  view: {
    zoom: 100,
    showGridLines: true,
    showRowColHeaders: true,
    rightToLeft: false,
    active: false,
    panes: null,
    selection: null,
  },
  columns: [],
  merges: [],
  format: { defaultRowHeight: null, defaultColumnWidth: null, customHeight: false },
  tabColor: null,
  autoFilter: null,
  conditional: [],
}

/** The sheets a person sees, which is not all of them. */
export const visibleSheets = (open: OpenWorkbook): OpenSheet[] =>
  open.sheets.filter((sheet) => !sheet.hidden)
