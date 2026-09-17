import { getPartText } from '@orangery/ooxml-core'
import { NUMBERING_PART, readDocxPackage } from './parts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isBulletList,
  nextAbstractNumId,
  nextNumId,
  parseNumbering,
  resolveNumbering,
} from './numbering'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

function wrap(body: string): string {
  return `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:numbering>`
}

const BULLET_AND_DECIMAL = wrap(
  '<w:abstractNum w:abstractNumId="0">' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>' +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="Symbol"/></w:rPr></w:lvl>' +
    '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>' +
    '</w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1">' +
    '<w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
    '<w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>' +
    '</w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    '<w:num w:numId="3"><w:abstractNumId w:val="1"/>' +
    '<w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="10"/><w:numFmt w:val="upperRoman"/>' +
    '<w:lvlText w:val="%1"/></w:lvl></w:lvlOverride></w:num>',
)

describe('parseNumbering', () => {
  const catalogue = parseNumbering(BULLET_AND_DECIMAL)

  it('reads abstract definitions and their levels', () => {
    expect(catalogue.abstract.size).toBe(2)
    expect(catalogue.abstract.get(0)?.levels.size).toBe(2)
  })

  it('reads instances and what they point at', () => {
    expect(catalogue.instances.get(2)?.abstractNumId).toBe(1)
  })

  it('reads the bullet glyph and its font', () => {
    const level = resolveNumbering(catalogue, 1, 0)
    expect(level?.text).toBe('•')
    expect(level?.bulletFont).toBe('Symbol')
  })

  it('converts level indentation from twips', () => {
    const level = resolveNumbering(catalogue, 1, 0)
    expect(level?.indentLeft).toBe(36)
    expect(level?.indentHanging).toBe(18)
  })

  it('reads a start value other than one', () => {
    expect(resolveNumbering(catalogue, 2, 0)?.start).toBe(3)
  })

  it('defaults start to one when absent', () => {
    expect(resolveNumbering(catalogue, 1, 1)?.start).toBe(1)
  })

  it('reads the number format per level', () => {
    expect(resolveNumbering(catalogue, 2, 0)?.format).toBe('decimal')
    expect(resolveNumbering(catalogue, 2, 1)?.format).toBe('lowerLetter')
  })

  it('maps an unrecognised format to "other" rather than guessing', () => {
    const odd = parseNumbering(
      wrap(
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="ideographDigital"/></w:lvl></w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
      ),
    )
    expect(resolveNumbering(odd, 1, 0)?.format).toBe('other')
  })
})

describe('instance overrides', () => {
  const catalogue = parseNumbering(BULLET_AND_DECIMAL)

  it('prefers an override over the abstract definition', () => {
    const level = resolveNumbering(catalogue, 3, 0)
    expect(level?.format).toBe('upperRoman')
    expect(level?.start).toBe(10)
  })

  it('falls through to the abstract definition for levels not overridden', () => {
    expect(resolveNumbering(catalogue, 3, 1)?.format).toBe('lowerLetter')
  })
})

describe('resolution failures', () => {
  const catalogue = parseNumbering(BULLET_AND_DECIMAL)

  it('returns null for an unknown numId', () => {
    expect(resolveNumbering(catalogue, 99, 0)).toBeNull()
  })

  it('returns null for a level the definition does not declare', () => {
    expect(resolveNumbering(catalogue, 1, 7)).toBeNull()
  })

  it('treats an unresolvable reference as a bullet rather than crashing', () => {
    expect(isBulletList(catalogue, 99, 0)).toBe(true)
  })
})

describe('isBulletList', () => {
  const catalogue = parseNumbering(BULLET_AND_DECIMAL)

  it('recognises a bullet list', () => {
    expect(isBulletList(catalogue, 1, 0)).toBe(true)
  })

  it('recognises a numbered list', () => {
    expect(isBulletList(catalogue, 2, 0)).toBe(false)
  })
})

describe('allocating new ids', () => {
  const catalogue = parseNumbering(BULLET_AND_DECIMAL)

  it('picks the smallest unused numId', () => {
    expect(nextNumId(catalogue)).toBe(4)
  })

  it('picks the smallest unused abstract id', () => {
    expect(nextAbstractNumId(catalogue)).toBe(2)
  })

  it('starts from the beginning for an empty catalogue', () => {
    const empty = parseNumbering('<nonsense/>')
    expect(nextNumId(empty)).toBe(1)
    expect(nextAbstractNumId(empty)).toBe(0)
  })
})

describe('real fixtures', () => {
  it('reads the numbering catalogue from a document with lists', async () => {
    const pkg = await readDocxPackage(await readFile(join(FIXTURES, 'lists.docx')))
    const catalogue = parseNumbering(getPartText(pkg, NUMBERING_PART) ?? '')

    expect(catalogue.abstract.size).toBeGreaterThan(0)
    expect(catalogue.instances.size).toBeGreaterThan(0)
  })
})
