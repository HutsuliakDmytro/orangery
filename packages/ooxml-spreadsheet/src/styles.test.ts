import { describe, expect, it } from 'vitest'
import { formatCodeOf, isDateFormat, readStyles, resolveStyle } from './styles'
import type { Styles } from './styles'

/**
 * What a cell looks like, after the indexes have been followed.
 *
 * A sheet carries no formatting: a cell states one index, and five lookups
 * later there is a font. Most of these are about the lookups going the right
 * way, because when they go the wrong way every cell in the file looks the
 * same and nothing says why.
 */

const STYLES =
  '<styleSheet xmlns="x">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;₴&quot;"/></numFmts>' +
  '<fonts count="3">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><scheme val="minor"/></font>' +
  '<font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Calibri"/></font>' +
  '<font><i/><u val="double"/><sz val="11"/><name val="Arial"/></font>' +
  '</fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.6"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFB2B2B2"/></left><right/><top/>' +
  '<bottom style="double"><color theme="0"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
  '<xf numFmtId="0" fontId="2" fillId="1" borderId="1" applyFont="1" applyFill="1"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1">' +
  '<alignment horizontal="center" vertical="top" wrapText="1" indent="2" textRotation="45"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1">' +
  '<protection locked="0"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<dxfs count="1"><dxf><font><b/><color rgb="FF9C0006"/></font>' +
  '<fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>' +
  '</styleSheet>'

const styles = (): Styles => {
  const read = readStyles(STYLES)
  if (read === null) throw new Error('the part holds no styles')
  return read
}

describe('reading the parts', () => {
  it('reads the fonts, each of its own shape', () => {
    const fonts = styles().fonts

    expect(fonts[0]).toMatchObject({ name: 'Calibri', size: 11, bold: false, scheme: 'minor' })
    expect(fonts[1]).toMatchObject({ bold: true, size: 14 })
    expect(fonts[2]).toMatchObject({ italic: true, underline: 'double', name: 'Arial' })
  })

  it('reads a stated element as yes and a stated nought as no', () => {
    // `<b/>` is bold and `<b val="0"/>` is not; getting this backwards makes
    // every font in the file bold.
    const off = readStyles(
      '<styleSheet xmlns="x"><fonts><font><b val="0"/></font></fonts></styleSheet>',
    )
    expect(off?.fonts[0]?.bold).toBe(false)
  })

  it('keeps a theme colour symbolic, with the tint that goes with it', () => {
    // Resolved when it is drawn and never when it is saved, or changing the
    // theme would stop recolouring the sheet.
    expect(styles().fills[2]?.foreground).toEqual({ kind: 'theme', index: 4, tint: 0.6 })
    expect(styles().fonts[1]?.color).toEqual({ kind: 'rgb', hex: 'FFFF0000' })
  })

  it('reads the edges of a border, and the ones that are not there', () => {
    const border = styles().borders[1]

    expect(border?.left).toEqual({ style: 'thin', color: { kind: 'rgb', hex: 'FFB2B2B2' } })
    expect(border?.bottom.style).toBe('double')
    expect(border?.right).toEqual({ style: null, color: null })
  })

  it('reads the custom format codes, which are the only ones in the file', () => {
    expect(styles().numberFormats.get(164)).toBe('#,##0.00 "₴"')
  })

  it('reads the formats conditional formatting lays over a cell', () => {
    expect(styles().differential[0]?.font).toMatchObject({ bold: true })
    expect(styles().differential[0]?.fill?.background).toEqual({ kind: 'rgb', hex: 'FFFFC7CE' })
  })

  it('says nothing about what such a format did not mention', () => {
    // The rule reddens the text and makes it bold. It has no opinion about
    // italics, and a reader that reported `italic: false` would straighten
    // every italic cell it highlighted.
    const format = styles().differential[0]

    expect(format?.font).not.toHaveProperty('italic')
    expect(format?.font).not.toHaveProperty('name')
  })

  it('reads a format that takes something away, which is not the same as silence', () => {
    const taken = readStyles(
      '<styleSheet xmlns="x"><dxfs count="1"><dxf><font><b val="0"/></font></dxf></dxfs>' +
        '</styleSheet>',
    )

    expect(taken?.differential[0]?.font).toEqual({ bold: false })
  })
})

describe('following a cell’s index', () => {
  it('finds the font, fill and border the entry points at', () => {
    const style = resolveStyle(styles(), 1)

    expect(style.font).toMatchObject({ bold: true, size: 14 })
    expect(style.fill?.pattern).toBe('solid')
    expect(style.border.left.style).toBe('thin')
  })

  it('reads the alignment, indent and rotation as the cell states them', () => {
    const style = resolveStyle(styles(), 1)

    expect(style.alignment).toMatchObject({
      horizontal: 'center',
      vertical: 'top',
      wrapText: true,
      indent: 2,
      textRotation: 45,
    })
  })

  it('takes what the entry does not apply from the style behind it', () => {
    // A cell that is Normal except for one thing states that one thing; a
    // reader ignoring `apply*` gives every cell the first font in the file.
    const style = resolveStyle(styles(), 2)

    expect(style.font).toMatchObject({ name: 'Arial', italic: true })
    expect(style.fill?.pattern).toBe('gray125')
  })

  it('gives a cell with no style at all the first of everything', () => {
    const style = resolveStyle(styles(), null)

    expect(style.numberFormat).toBe(0)
    expect(style.font?.name).toBe('Calibri')
  })

  it('reads whether a cell is locked, which matters once a sheet is protected', () => {
    expect(resolveStyle(styles(), 3).locked).toBe(false)
    expect(resolveStyle(styles(), 0).locked).toBe(true)
  })

  it('answers for an index the file does not have rather than throwing', () => {
    expect(resolveStyle(styles(), 99).numberFormat).toBe(0)
  })
})

describe('number formats', () => {
  it('knows the ones no file states', () => {
    // Ids below 164 are not written down; a reader without them shows a date
    // as 45292 and a percentage as 0.15.
    expect(formatCodeOf(styles(), 14)).toBe('mm-dd-yy')
    expect(formatCodeOf(styles(), 9)).toBe('0%')
    expect(formatCodeOf(styles(), 0)).toBe('General')
  })

  it('prefers the file’s own code for an id it states', () => {
    expect(formatCodeOf(styles(), 164)).toBe('#,##0.00 "₴"')
  })

  it('says nothing for an id nobody has defined', () => {
    expect(formatCodeOf(styles(), 200)).toBeNull()
  })

  it('tells a date format from one that only looks like one', () => {
    expect(isDateFormat('yyyy-mm-dd')).toBe(true)
    expect(isDateFormat('[h]:mm:ss')).toBe(true)
    expect(isDateFormat('#,##0.00')).toBe(false)
    // The letters inside a quoted literal or a colour are not format codes.
    expect(isDateFormat('#,##0 "days"')).toBe(false)
    expect(isDateFormat('[Red]#,##0')).toBe(false)
  })
})
