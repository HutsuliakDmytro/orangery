import { describe, expect, it } from 'vitest'
import { readStyles } from './styles'
import type { Styles } from './styles'
import { noStyleChanges, numberFormatId, patchStyles, styleShowing } from './styles-edit'

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
