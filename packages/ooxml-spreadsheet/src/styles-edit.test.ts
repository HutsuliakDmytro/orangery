import { describe, expect, it } from 'vitest'
import { readStyles } from './styles'
import type { Styles } from './styles'
import { noStyleChanges, numberFormatId, patchStyles, styleShowing, styleWith } from './styles-edit'

/**
 * Giving a cell a look the file did not have.
 *
 * The two things that can go wrong here are both silent. An entry added in
 * the wrong place renumbers every cell after it, so a file opens with the
 * wrong formatting everywhere and nothing to point at. And an entry added
 * when an equal one exists makes a file that grows a little on every save
 * until some other reader gives up on it.
 */

const SHEET =
  '<styleSheet xmlns="x">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;₴&quot;"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/></font><font><b/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" ' +
  'applyFont="1"/>' +
  '</cellXfs></styleSheet>'

const styles = (): Styles => {
  const read = readStyles(SHEET)
  if (read === null) throw new Error('the part holds no styles')
  return read
}

describe('the id of a format code', () => {
  it('is the one the file already gave it', () => {
    const own = styles()
    expect(numberFormatId(own, noStyleChanges(), '#,##0.00 "₴"')).toBe(164)
  })

  it('is Excel’s own where Excel has one, and is not added to the file', () => {
    // A file declaring `0%` beside Excel's id 9 has two names for one thing,
    // and Excel rewrites it on save.
    const own = styles()
    const changes = noStyleChanges()

    expect(numberFormatId(own, changes, '0%')).toBe(9)
    expect(changes.numberFormats.size).toBe(0)
  })

  it('is a new one past the reserved range for a code nobody has', () => {
    const own = styles()
    const changes = noStyleChanges()

    expect(numberFormatId(own, changes, 'yyyy-mm-dd hh:mm')).toBe(165)
    expect(changes.numberFormats.get(165)).toBe('yyyy-mm-dd hh:mm')
  })

  it('gives the same code the same id twice', () => {
    const own = styles()
    const changes = noStyleChanges()

    const first = numberFormatId(own, changes, 'yyyy-mm-dd')
    expect(numberFormatId(own, changes, 'yyyy-mm-dd')).toBe(first)
    expect(changes.numberFormats.size).toBe(1)
  })
})

describe('a cell’s style, changed to show a format', () => {
  it('keeps everything else the cell looked like', () => {
    // A bold cell that becomes a percentage is still bold.
    const own = styles()
    const index = styleShowing(own, noStyleChanges(), 1, '0%')

    expect(own.cellFormats[index]).toMatchObject({ font: 1, applies: { font: true } })
  })

  it('leaves a cell that already shows it exactly where it was', () => {
    const own = styles()
    expect(styleShowing(own, noStyleChanges(), 1, '#,##0.00 "₴"')).toBe(1)
  })

  it('adds one entry for a look, not one per cell', () => {
    const own = styles()
    const changes = noStyleChanges()

    const first = styleShowing(own, changes, 0, '0%')
    const second = styleShowing(own, changes, 0, '0%')

    expect(second).toBe(first)
    expect(changes.cellFormats).toHaveLength(1)
  })

  it('puts a new entry at the end, where its index is its position', () => {
    const own = styles()
    const index = styleShowing(own, noStyleChanges(), 0, '0%')

    expect(index).toBe(2)
  })
})

describe('putting the additions back into the part', () => {
  it('changes nothing at all when nothing was added', () => {
    expect(patchStyles(SHEET, noStyleChanges())).toBe(SHEET)
  })

  it('appends the entry and counts it', () => {
    const own = styles()
    const changes = noStyleChanges()
    styleShowing(own, changes, 0, '0%')

    const patched = patchStyles(SHEET, changes)

    expect(patched).toContain('<cellXfs count="3">')
    expect(patched).toContain(
      '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
    )
  })

  it('keeps the entries that were there, in the order they were in', () => {
    // A cell's index is its position, so an entry inserted anywhere but the
    // end restyles every cell after it, silently and everywhere.
    const own = styles()
    const changes = noStyleChanges()
    styleShowing(own, changes, 0, '0%')

    const inside =
      /<cellXfs[^>]*>([\s\S]*)<\/cellXfs>/u.exec(patchStyles(SHEET, changes))?.[1] ?? ''
    const order = [...inside.matchAll(/numFmtId="(\d+)"/gu)].map((one) => one[1])

    expect(order).toEqual(['0', '164', '9'])
  })

  it('adds a custom code to the formats the file already lists', () => {
    const own = styles()
    const changes = noStyleChanges()
    styleShowing(own, changes, 0, 'yyyy-mm-dd')

    const patched = patchStyles(SHEET, changes)

    expect(patched).toContain('<numFmts count="2">')
    expect(patched).toContain('<numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>')
    expect(patched).toContain('formatCode="#,##0.00 &quot;₴&quot;"')
  })

  it('makes the element for them in a file that has none, before the fonts', () => {
    const bare =
      '<styleSheet xmlns="x"><fonts count="1"><font/></fonts>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>'
    const own = readStyles(bare)
    if (own === null) throw new Error('the part holds no styles')

    const changes = noStyleChanges()
    styleShowing(own, changes, 0, 'yyyy-mm-dd')
    const patched = patchStyles(bare, changes)

    expect(patched.indexOf('<numFmts')).toBeLessThan(patched.indexOf('<fonts'))
  })
})

describe('changing how a cell looks', () => {
  it('bolds it without resizing it', () => {
    // The whole difference between a toolbar and a style picker: every part
    // starts from what the cell already had.
    const own = styles()
    const index = styleWith(own, noStyleChanges(), 1, { font: { bold: true } })
    const font = own.fonts[own.cellFormats[index]?.font ?? 0]

    expect(font).toMatchObject({ bold: true })
    expect(own.cellFormats[index]?.applies.font).toBe(true)
  })

  it('keeps the font it had when only the fill changes', () => {
    const own = styles()
    const index = styleWith(own, noStyleChanges(), 1, {
      fill: { kind: 'rgb', hex: 'FFFFFF00' },
    })

    expect(own.cellFormats[index]?.font).toBe(1)
    expect(own.fills[own.cellFormats[index]?.fill ?? 0]).toMatchObject({
      pattern: 'solid',
      foreground: { kind: 'rgb', hex: 'FFFFFF00' },
    })
  })

  it('takes a fill away when asked for none', () => {
    const own = styles()
    const index = styleWith(own, noStyleChanges(), 1, { fill: null })

    expect(own.fills[own.cellFormats[index]?.fill ?? 0]?.pattern).toBe('none')
  })

  it('sets the edges named and leaves the others where they were', () => {
    const own = styles()
    const index = styleWith(own, noStyleChanges(), 0, {
      border: { bottom: { style: 'thin', color: { kind: 'rgb', hex: 'FF000000' } } },
    })
    const border = own.borders[own.cellFormats[index]?.border ?? 0]

    expect(border?.bottom.style).toBe('thin')
    expect(border?.top.style).toBeNull()
  })

  it('merges an alignment rather than replacing it', () => {
    const own = styles()
    const centred = styleWith(own, noStyleChanges(), 0, { alignment: { horizontal: 'center' } })
    const wrapped = styleWith(own, noStyleChanges(), centred, { alignment: { wrapText: true } })

    expect(own.cellFormats[wrapped]?.alignment).toMatchObject({
      horizontal: 'center',
      wrapText: true,
    })
  })

  it('gives the same look the same index, however many cells ask', () => {
    const own = styles()
    const changes = noStyleChanges()

    const first = styleWith(own, changes, 0, { font: { bold: true } })
    const second = styleWith(own, changes, 0, { font: { bold: true } })

    expect(second).toBe(first)
    expect(changes.fonts).toHaveLength(1)
    expect(changes.cellFormats).toHaveLength(1)
  })

  it('starts from the look a cell shows, not from the entry it points at', () => {
    // An entry that states no font of its own takes one from the named style
    // behind it; bolding that cell has to keep the font it was showing.
    const based =
      '<styleSheet xmlns="x">' +
      '<fonts count="2"><font><sz val="11"/></font><font><sz val="18"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>'
    const own = readStyles(based)
    if (own === null) throw new Error('the part holds no styles')

    const index = styleWith(own, noStyleChanges(), 0, { font: { bold: true } })

    expect(own.fonts[own.cellFormats[index]?.font ?? 0]).toMatchObject({ size: 18, bold: true })
  })
})

describe('putting a new look back into the part', () => {
  it('writes the font, the fill and the border it added', () => {
    const own = styles()
    const changes = noStyleChanges()
    styleWith(own, changes, 0, {
      font: { bold: true, color: { kind: 'rgb', hex: 'FFC00000' } },
      fill: { kind: 'rgb', hex: 'FFFFFF00' },
      border: { bottom: { style: 'thin', color: null } },
    })

    const patched = patchStyles(SHEET, changes)

    expect(patched).toContain('<font><b/><sz val="11"/><color rgb="FFC00000"/></font>')
    expect(patched).toContain('<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/>')
    expect(patched).toContain('<bottom style="thin"/>')
  })

  it('counts them, and puts them after the ones that were there', () => {
    const own = styles()
    const changes = noStyleChanges()
    styleWith(own, changes, 0, { font: { bold: true } })

    const patched = patchStyles(SHEET, changes)
    const inside = /<fonts[^>]*>([\s\S]*?)<\/fonts>/u.exec(patched)?.[1] ?? ''

    expect(patched).toContain('<fonts count="3">')
    // The two that were there keep their places, which is what their indexes
    // mean.
    expect(inside.indexOf('<sz val="11"/>')).toBeLessThan(inside.indexOf('<b/>'))
  })

  it('leaves the part alone when a look was already in it', () => {
    const own = styles()
    const changes = noStyleChanges()
    // Font 1 of the fixture is already bold.
    styleWith(own, changes, 1, { font: { bold: true } })

    expect(changes.fonts).toHaveLength(0)
    expect(patchStyles(SHEET, changes)).toContain('<fonts count="2">')
  })
})
