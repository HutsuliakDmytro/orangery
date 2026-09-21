import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { workbookBytes } from './save'
import { clearLinks, followLink, linkAt, linkFor, putLink } from './links'

/**
 * The cells that are also a way somewhere else.
 *
 * Where a link points is kept in two different places depending on where it
 * goes, and the thing worth testing is that typing one address rather than
 * another decides which — nobody should have to say "this is a web link".
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

const cell = { sheet: null, from: { row: 0, column: 0 }, to: { row: 0, column: 0 } }

describe('reading what somebody typed', () => {
  it('takes a bare domain for an address on the internet', () => {
    const link = linkFor(cell, 'example.org', null)

    expect(link?.target).toBe('https://example.org/')
    expect(link?.location).toBeNull()
  })

  it('keeps an address that already says what it is', () => {
    expect(linkFor(cell, 'mailto:someone@example.org', null)?.target).toBe(
      'mailto:someone@example.org',
    )
  })

  it('takes a reference for a place in this workbook', () => {
    const link = linkFor(cell, 'Notes!A1', null)

    expect(link?.location).toBe('Notes!A1')
    expect(link?.target).toBeNull()
  })

  it('takes a hash for one as well, which is how Excel writes them', () => {
    expect(linkFor(cell, '#Notes!B2', null)?.location).toBe('Notes!B2')
  })

  it('refuses an address nobody should be handed', () => {
    // A partly cleaned script URL is still a script URL.
    expect(linkFor(cell, 'javascript:alert(1)', null)).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(linkFor(cell, '   ', null)).toBeNull()
  })
})

describe('putting one on a cell', () => {
  it('is found by the cell it covers', () => {
    const link = linkFor(cell, 'example.org', 'The site')
    if (link === null) throw new Error('the link was refused')

    putLink(sheet, link)
    expect(linkAt(sheet, { row: 0, column: 0 })?.tooltip).toBe('The site')
  })

  it('replaces one that was already there', () => {
    const first = linkFor(cell, 'example.org', null)
    const second = linkFor(cell, 'elsewhere.org', null)
    if (first === null || second === null) throw new Error('a link was refused')

    putLink(sheet, first)
    putLink(sheet, second)

    expect(sheet.links).toHaveLength(1)
    expect(linkAt(sheet, { row: 0, column: 0 })?.target).toBe('https://elsewhere.org/')
  })

  it('survives a save and an open', async () => {
    const link = linkFor(cell, 'example.org', 'The site')
    if (link === null) throw new Error('the link was refused')

    putLink(sheet, link)
    const again = await openWorkbook(await workbookBytes(open, { edited: true }))

    expect(again.sheets[0]?.links[0]?.target).toBe('https://example.org/')
    expect(again.sheets[0]?.links[0]?.tooltip).toBe('The site')
  })

  it('comes off again, and stays off after a save', async () => {
    const link = linkFor(cell, 'example.org', null)
    if (link === null) throw new Error('the link was refused')

    putLink(sheet, link)
    expect(clearLinks(sheet, cell)).not.toBeNull()

    const again = await openWorkbook(await workbookBytes(open, { edited: true }))
    expect(again.sheets[0]?.links).toEqual([])
  })

  it('says nothing happened where there was no link to remove', () => {
    expect(clearLinks(sheet, cell)).toBeNull()
  })

  it('hands back both halves, so it can be taken back', () => {
    const link = linkFor(cell, 'example.org', null)
    if (link === null) throw new Error('the link was refused')

    const change = putLink(sheet, link)
    expect(change).toMatchObject({ kind: 'links', before: [], sheet: sheet.path })
  })
})

describe('following one', () => {
  it('gives back the cell a reference names, and the sheet it is on', () => {
    const link = linkFor(cell, 'Notes!B2', null)
    if (link === null) throw new Error('the link was refused')

    expect(followLink(open, link)).toEqual({ sheet: 'Notes', cell: { row: 1, column: 1 } })
  })

  it('stays on this sheet for a reference that names none', () => {
    const link = linkFor(cell, 'B2', null)
    if (link === null) throw new Error('the link was refused')

    expect(followLink(open, link)?.cell).toEqual({ row: 1, column: 1 })
  })

  it('hands an outside address to the window and says nothing came back', () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const link = linkFor(cell, 'example.org', null)
    if (link === null) throw new Error('the link was refused')

    expect(followLink(open, link)).toBeNull()
    expect(opened).toHaveBeenCalledWith('https://example.org/', '_blank', 'noopener,noreferrer')
    opened.mockRestore()
  })

  it('refuses to open an address a file brought with it that it should not', () => {
    // The target came out of somebody else's file, so it is checked again
    // rather than trusted because it is in a workbook.
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)

    followLink(open, {
      range: cell,
      target: 'javascript:alert(1)',
      location: null,
      tooltip: null,
      relationshipId: null,
    })

    expect(opened).not.toHaveBeenCalled()
    opened.mockRestore()
  })
})
