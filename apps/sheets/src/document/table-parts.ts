import {
  writeRelationships,
  addRelationship,
  ensureOverride,
  getPartText,
  parseRelationships,
  partDirectory,
  setPartText,
} from '@orangery/ooxml-core'
import { replaceTableParts, writeTable } from '@orangery/ooxml-spreadsheet'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * `xl/tables/*` and the relationships that reach them.
 *
 * Its own module because two very different things ask for it. Making a table
 * writes one; so does putting a row into the middle of a sheet, which moves
 * every table below it.
 *
 * Called when a table changed and not at save time, which is the opposite of
 * how the rest of a sheet is written and is deliberate: a table part can hold
 * a sort state and extensions nothing here models, and regenerating one
 * nobody touched would throw them away. All of a sheet's tables at once,
 * though — a sheet has a handful, the parts are small, and the alternative is
 * remembering which part each came from.
 */

const TABLE_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml'
const TABLE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table'

/** Every table of a sheet written into the package. */
export function writeTables(open: OpenWorkbook, sheet: OpenSheet): void {
  const relationshipsPath = relationshipsOf(sheet.path)
  const relationships = parseRelationships(getPartText(open.pkg, relationshipsPath) ?? '')
  const had = [...relationships.values()].some((one) => one.type === TABLE_RELATIONSHIP)

  // A sheet that has no tables and never had any: writing would give it a
  // relationships part it did not come with.
  if (!had && sheet.tables.length === 0) return

  // The ones that were there are replaced, so a table taken away leaves no
  // part behind pointing at nothing.
  for (const [id, one] of [...relationships]) {
    if (one.type === TABLE_RELATIONSHIP) relationships.delete(id)
  }

  const ids: string[] = []

  for (const [at, table] of sheet.tables.entries()) {
    const path = `xl/tables/table${String(nextNumber(open, at))}.xml`
    setPartText(open.pkg, path, writeTable(table, at + 1))
    ensureOverride(open.pkg, path, TABLE_TYPE)

    const link = addRelationship(relationships, TABLE_RELATIONSHIP, relativeTo(sheet.path, path))
    ids.push(link.id)
  }

  writeRelationships(open.pkg, relationshipsPath, relationships)
  setPartText(open.pkg, sheet.path, replaceTableParts(getPartText(open.pkg, sheet.path) ?? '', ids))
}

/** The part number a table gets: its own if it has one, the next free if not. */
function nextNumber(open: OpenWorkbook, at: number): number {
  let number = at + 1
  const used = new Set(
    [...open.pkg.parts.keys()]
      .map((path) => /^xl\/tables\/table(\d+)\.xml$/u.exec(path)?.[1])
      .filter((one): one is string => one !== undefined),
  )

  while (used.has(String(number)) && number <= at) number += 1
  return number
}

const relationshipsOf = (path: string): string => {
  const directory = partDirectory(path)
  return `${directory}/_rels/${path.slice(directory.length + 1)}.rels`
}

function relativeTo(from: string, to: string): string {
  const here = partDirectory(from).split('/')
  const there = to.split('/')

  let same = 0
  while (same < here.length && here[same] === there[same]) same += 1

  return [...here.slice(same).map(() => '..'), ...there.slice(same)].join('/')
}
