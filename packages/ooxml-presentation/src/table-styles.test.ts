import { describe, expect, it } from 'vitest'
import { setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { builtInApproximation, partsFor, readTableStyles, styleFor } from './table-styles'
import { TABLE_STYLES_PART } from './parts'

/**
 * Painting a table beyond what its cells say.
 *
 * The case worth remembering is that PowerPoint's own styles are not in the
 * file: `tableStyles.xml` usually holds a GUID and nothing else, so most of
 * what this does is decide what to do when there is nothing to read.
 */

const properties = {
  firstRow: false,
  lastRow: false,
  firstColumn: false,
  lastColumn: false,
  bandedRows: false,
  bandedColumns: false,
  styleId: null,
}

function packageWith(xml: string): OoxmlPackage {
  const pkg: OoxmlPackage = { parts: new Map() }
  setPartText(pkg, TABLE_STYLES_PART, xml)
  return pkg
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

describe('reading the styles a deck writes out', () => {
  it('reads a whole-table fill', () => {
    const styles = readTableStyles(
      packageWith(
        `<a:tblStyleLst ${NS}><a:tblStyle styleId="{A}"><a:wholeTbl><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl></a:tblStyle></a:tblStyleLst>`,
      ),
    )

    const fill = styles.get('{A}')?.wholeTable?.fill
    expect(fill).toMatchObject({ kind: 'solid' })
  })

  it('reads that a header row is bold', () => {
    const styles = readTableStyles(
      packageWith(
        `<a:tblStyleLst ${NS}><a:tblStyle styleId="{A}"><a:firstRow><a:tcTxStyle b="on"/></a:firstRow></a:tblStyle></a:tblStyleLst>`,
      ),
    )

    expect(styles.get('{A}')?.firstRow?.bold).toBe(true)
  })

  it('reads the colour a header row states for its words', () => {
    // The point of a header row: solid accent behind white text. Unread, the
    // words fall back to the theme's text colour and come out black on blue.
    const styles = readTableStyles(
      packageWith(
        `<a:tblStyleLst ${NS}><a:tblStyle styleId="{A}"><a:firstRow><a:tcTxStyle b="on">` +
          '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>' +
          '</a:tcTxStyle></a:firstRow></a:tblStyle></a:tblStyleLst>',
      ),
    )

    expect(styles.get('{A}')?.firstRow?.color).toMatchObject({
      source: { kind: 'scheme', name: 'lt1' },
    })
  })

  it('finds nothing in the file PowerPoint actually writes', () => {
    // A GUID and no definition, which is what a deck from PowerPoint contains.
    const styles = readTableStyles(packageWith(`<a:tblStyleLst ${NS} def="{5C22}"/>`))
    expect(styles.size).toBe(0)
  })

  it('finds nothing when there is no part at all', () => {
    expect(readTableStyles({ parts: new Map() }).size).toBe(0)
  })
})

describe('choosing a style', () => {
  it('uses the style the deck writes out, when it writes one', () => {
    const styles = readTableStyles(
      packageWith(
        `<a:tblStyleLst ${NS}><a:tblStyle styleId="{A}"><a:firstRow><a:tcTxStyle b="on"/></a:firstRow></a:tblStyle></a:tblStyleLst>`,
      ),
    )

    expect(styleFor(styles, '{A}').firstRow?.bold).toBe(true)
  })

  it('falls back to the approximation for a built-in it cannot read', () => {
    // Drawing the table bare is wrong in a way that is easy to miss: a header
    // that should be solid accent is simply white.
    expect(styleFor(new Map(), '{5C22}').firstRow?.fill).not.toBeNull()
  })

  it('paints nothing at all for a table that names no style', () => {
    expect(styleFor(new Map(), null).firstRow).toBeNull()
  })
})

describe('the stand-in for a style the deck does not contain', () => {
  it('writes the header row in the theme’s light colour, not in the app’s', () => {
    // "Medium Style 2" is a solid accent header with white bold text. `lt1`
    // rather than white, because on a deck whose light colour is not white the
    // header text is that colour.
    expect(builtInApproximation().firstRow?.color).toMatchObject({
      source: { kind: 'scheme', name: 'lt1' },
    })
  })
})

describe('which part applies to a cell', () => {
  const style = builtInApproximation()

  it('gives the header row the header part', () => {
    const parts = partsFor(
      style,
      { ...properties, firstRow: true },
      {
        row: 0,
        column: 0,
        rows: 4,
      },
    )
    expect(parts).toContain(style.firstRow)
  })

  it('bands from the first body row, not from the header', () => {
    const withHeader = { ...properties, firstRow: true, bandedRows: true }

    // Row 1 is the first body row and is unbanded; row 2 is the stripe.
    expect(partsFor(style, withHeader, { row: 1, column: 0, rows: 5 })).not.toContain(
      style.bandedRow,
    )
    expect(partsFor(style, withHeader, { row: 2, column: 0, rows: 5 })).toContain(style.bandedRow)
  })

  it('lets the header win over the banding', () => {
    const parts = partsFor(
      style,
      { ...properties, firstRow: true, bandedRows: true },
      { row: 0, column: 0, rows: 5 },
    )
    expect(parts.at(-1)).toBe(style.firstRow)
  })

  it('does nothing when the table asks for nothing', () => {
    expect(partsFor(style, properties, { row: 0, column: 0, rows: 4 })).toEqual([])
  })
})
