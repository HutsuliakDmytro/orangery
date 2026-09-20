import { linkCovering, parseRange, withLink, withoutLinks } from '@orangery/ooxml-spreadsheet'
import type { Hyperlink } from '@orangery/ooxml-spreadsheet'
import { normalizeUrl } from '@orangery/platform'
import type { Change } from './history'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * The cells that are also a way somewhere else.
 *
 * A link is a rectangle in a list, like a merge, and changing the list is all
 * that adding or removing one is. What it is not is a change to a cell, which
 * is why none of this goes through the cell history: the worksheet's own list
 * is what changed.
 *
 * Where a link goes is the interesting part. An address outside the workbook
 * is handed to the operating system, which knows what a browser is; one
 * inside it is a reference, and following it means moving the cursor — the
 * same thing the name box does, and it is done by the caller for that reason.
 */

/** What somebody typed into the box, read as the kind of link it is. */
export function linkFor(
  range: Hyperlink['range'],
  address: string,
  tooltip: string | null,
): Hyperlink | null {
  const text = address.trim()
  if (text === '') return null

  // A reference is a place in this workbook; anything else is an address the
  // system will have to open. `Sheet1!A1` is a reference and `example.org` is
  // not, and the difference is whether it parses.
  const inside = text.startsWith('#') ? text.slice(1) : text
  const reference = parseRange(inside.includes('!') ? inside : `${inside}:${inside}`)

  if (text.startsWith('#') || (reference !== null && !/^[a-z][a-z\d+.-]*:/iu.test(text))) {
    return { range, target: null, location: inside, tooltip, relationshipId: null }
  }

  // Normalised the way every app here normalises one: a bare domain becomes
  // an address, and a scheme nobody should be handed — `javascript:` above
  // all — is refused rather than tidied up.
  const target = normalizeUrl(text)
  return target === null ? null : { range, target, location: null, tooltip, relationshipId: null }
}

/** The link on a cell, if there is one. */
export const linkAt = (sheet: OpenSheet, cell: { row: number; column: number }): Hyperlink | null =>
  linkCovering(sheet.links, cell)

/** A link put on a range, replacing whatever was under it, as a change. */
export function putLink(sheet: OpenSheet, link: Hyperlink): Change {
  const before = sheet.links
  sheet.links = withLink(before, link)

  return { kind: 'links', sheet: sheet.path, before, after: sheet.links }
}

/** The links over a range taken off, or nothing where there were none. */
export function clearLinks(sheet: OpenSheet, range: Hyperlink['range']): Change | null {
  const before = sheet.links
  const after = withoutLinks(before, range)
  if (after.length === before.length) return null

  sheet.links = after
  return { kind: 'links', sheet: sheet.path, before, after }
}

/**
 * Follows a link, and says where inside the workbook it went.
 *
 * An outside address goes to the operating system and nothing comes back; a
 * reference is handed to the caller, because moving a cursor is the window's
 * business rather than the document's.
 */
export function followLink(
  open: OpenWorkbook,
  link: Hyperlink,
): { sheet: string | null; cell: { row: number; column: number } } | null {
  if (link.target !== null) {
    // Through the webview, so the system's own handler takes over — the same
    // way Docs opens one. A target out of a file somebody else wrote is
    // checked again here rather than trusted: it was not typed into this app.
    const safe = normalizeUrl(link.target)
    if (safe !== null) window.open(safe, '_blank', 'noopener,noreferrer')
    return null
  }

  if (link.location === null) return null

  const at = link.location.lastIndexOf('!')
  const name = at < 0 ? null : link.location.slice(0, at).replace(/^'|'$/gu, '')
  const reference = at < 0 ? link.location : link.location.slice(at + 1)

  const range = parseRange(reference.includes(':') ? reference : `${reference}:${reference}`)
  if (range === null) {
    // A defined name, which needs the workbook to say what it stands for.
    const defined = open.workbook.definedNames.find((one) => one.name === link.location)
    if (defined === undefined) return null

    const stood = parseRange(defined.formula.replace(/\$/gu, ''))
    return stood === null ? null : { sheet: stood.sheet, cell: stood.from }
  }

  return { sheet: name ?? range.sheet, cell: range.from }
}
