import { getPartText, setPartText } from '@orangery/ooxml-core'
import {
  addSheet as addSheetPart,
  freeName,
  moveSheet as moveSheetEntry,
  removeSheet as removeSheetEntry,
  renameSheet as renameSheetEntry,
  replaceSheetData,
  setSheetState,
  setTabColor,
} from '@orangery/ooxml-spreadsheet'
import { openSheetOf } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * The tabs along the bottom: adding one, taking one away, moving them about.
 *
 * None of this is undoable, and that is deliberate rather than unfinished.
 * Excel does not undo a deleted sheet either, and a history that could would
 * have to hold a whole worksheet part — the cells, the drawings, the comments,
 * the parts they point at — in a step that otherwise holds a few cells. What
 * takes the place of undo is being asked first, which the window does.
 *
 * Each operation moves the package and the model together. The package is
 * what gets saved; the model is what is on screen, and a version of either
 * that the other does not know about is the beginning of a file nobody can
 * open.
 */

/** Where a sheet sits among all of them, hidden ones included. */
export const indexOfSheet = (open: OpenWorkbook, path: string): number =>
  open.sheets.findIndex((one) => one.path === path)

/** A name for a new sheet that no sheet already has. */
export const nextSheetName = (open: OpenWorkbook): string => {
  const taken = open.sheets.map((one) => one.name)

  for (let number = open.sheets.length + 1; ; number += 1) {
    const tried = `Sheet${String(number)}`
    if (freeName(taken, tried) === tried) return tried
  }
}

/**
 * A sheet added, or an existing one duplicated, and where it landed.
 *
 * A duplicate carries what is on screen rather than what was last saved: the
 * cells go into the part before it is copied, or the copy would be of a sheet
 * as it stood when the file was opened.
 */
export function addSheet(
  open: OpenWorkbook,
  options: { name?: string; at?: number; copyOf?: OpenSheet } = {},
): number | null {
  const source = options.copyOf
  if (source !== undefined) {
    const xml = getPartText(open.pkg, source.path)
    if (xml !== undefined) setPartText(open.pkg, source.path, replaceSheetData(xml, source.cells))
  }

  const added = addSheetPart(open.pkg, options.name ?? nextSheetName(open), {
    ...(options.at === undefined ? {} : { at: options.at }),
    ...(source === undefined ? {} : { copyOf: source.path }),
  })
  if (added === null) return null

  const entry = {
    name: added.name,
    sheetId: null,
    path: added.path,
    state: 'visible' as const,
  }

  open.workbook.sheets.splice(added.at, 0, entry)
  open.sheets.splice(added.at, 0, openSheetOf(open.pkg, entry))

  return added.at
}

/** A sheet taken away; the last one stays, because a workbook needs a sheet. */
export function removeSheet(open: OpenWorkbook, at: number): boolean {
  if (!removeSheetEntry(open.pkg, at)) return false

  open.workbook.sheets.splice(at, 1)
  open.sheets.splice(at, 1)
  return true
}

/** A sheet renamed, with the name it actually got. */
export function renameSheet(open: OpenWorkbook, at: number, name: string): string | null {
  const called = renameSheetEntry(open.pkg, at, name)
  if (called === null) return null

  const entry = open.workbook.sheets[at]
  const sheet = open.sheets[at]
  if (entry !== undefined) entry.name = called
  if (sheet !== undefined) sheet.name = called

  return called
}

/** A sheet moved among its neighbours. */
export function moveSheet(open: OpenWorkbook, from: number, to: number): boolean {
  if (!moveSheetEntry(open.pkg, from, to)) return false

  const entry = open.workbook.sheets.splice(from, 1)[0]
  const sheet = open.sheets.splice(from, 1)[0]
  if (entry !== undefined) open.workbook.sheets.splice(to, 0, entry)
  if (sheet !== undefined) open.sheets.splice(to, 0, sheet)

  return true
}

/**
 * A sheet hidden, or brought back.
 *
 * The last visible sheet stays visible: a workbook showing nothing is one
 * whose tabs a person cannot get back to.
 */
export function hideSheet(open: OpenWorkbook, at: number, hidden: boolean): boolean {
  const sheet = open.sheets[at]
  if (sheet === undefined) return false
  if (hidden && open.sheets.filter((one) => !one.hidden).length < 2) return false

  if (!setSheetState(open.pkg, at, hidden ? 'hidden' : 'visible')) return false

  sheet.hidden = hidden
  const entry = open.workbook.sheets[at]
  if (entry !== undefined) entry.state = hidden ? 'hidden' : 'visible'

  return true
}

/** The colour of a tab, which the worksheet part keeps rather than the workbook. */
export function colorTab(open: OpenWorkbook, at: number, color: string | null): boolean {
  const sheet = open.sheets[at]
  if (sheet === undefined) return false
  if (!setTabColor(open.pkg, sheet.path, color)) return false

  sheet.sheet = { ...sheet.sheet, tabColor: color }
  return true
}
