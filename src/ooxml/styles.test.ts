import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, readPackage, STYLES_PART } from './package'
import { headingLevelOf, parseStyles, resolveStyle, visibleParagraphStyles } from './styles'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

function wrap(body: string): string {
  return `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:styles>`
}

describe('docDefaults', () => {
  it('reads the document-wide run defaults', () => {
    const catalogue = parseStyles(
      wrap(
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>',
      ),
    )
    expect(catalogue.defaults.fontFamily).toBe('Calibri')
    expect(catalogue.defaults.fontSize).toBe(11)
  })

  it('reads the document-wide paragraph defaults', () => {
    const catalogue = parseStyles(
      wrap(
        '<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
      ),
    )
    expect(catalogue.defaults.spaceAfter).toBe(8)
    expect(catalogue.defaults.lineHeight).toBeCloseTo(1.08, 2)
  })
})

describe('style definitions', () => {
  const catalogue = parseStyles(
    wrap(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
        '<w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
        '<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Hidden"><w:name w:val="Hidden"/><w:semiHidden/></w:style>' +
        '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>',
    ),
  )

  it('reads id, name, basedOn and next', () => {
    const heading = catalogue.styles.get('Heading1')
    expect(heading?.name).toBe('heading 1')
    expect(heading?.basedOn).toBe('Normal')
    expect(heading?.next).toBe('Normal')
  })

  it('identifies the default paragraph style', () => {
    expect(catalogue.defaultParagraphStyleId).toBe('Normal')
  })

  it('records the style type', () => {
    expect(catalogue.styles.get('Emphasis')?.type).toBe('character')
  })

  it('flags semi-hidden styles', () => {
    expect(catalogue.styles.get('Hidden')?.hidden).toBe(true)
  })

  it('omits hidden and non-paragraph styles from the dropdown list', () => {
    const visible = visibleParagraphStyles(catalogue).map((style) => style.id)
    expect(visible).toContain('Normal')
    expect(visible).toContain('Heading1')
    expect(visible).not.toContain('Hidden')
    expect(visible).not.toContain('Emphasis')
  })
})

describe('resolveStyle', () => {
  const catalogue = parseStyles(
    wrap(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
        '<w:basedOn w:val="Normal"/><w:rPr><w:b/><w:rFonts w:ascii="Cambria"/><w:sz w:val="32"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
        '<w:basedOn w:val="Heading1"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style>',
    ),
  )

  it('falls back to document defaults', () => {
    expect(resolveStyle(catalogue, 'Normal').fontFamily).toBe('Calibri')
  })

  it('lets a style override what it inherits', () => {
    expect(resolveStyle(catalogue, 'Heading1').fontSize).toBe(16)
  })

  it('inherits through more than one level', () => {
    const heading2 = resolveStyle(catalogue, 'Heading2')
    // Its own size, but bold and the font come from Heading1.
    expect(heading2.fontSize).toBe(13)
    expect(heading2.bold).toBe(true)
    expect(heading2.fontFamily).toBe('Cambria')
  })

  it('returns the defaults for an unknown style rather than throwing', () => {
    expect(resolveStyle(catalogue, 'DoesNotExist').fontFamily).toBe('Calibri')
  })

  it('breaks a basedOn cycle instead of looping forever', () => {
    const cyclic = parseStyles(
      wrap(
        '<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/><w:rPr><w:b/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/><w:rPr><w:i/></w:rPr></w:style>',
      ),
    )
    expect(() => resolveStyle(cyclic, 'A')).not.toThrow()
    expect(resolveStyle(cyclic, 'A').bold).toBe(true)
  })
})

describe('headingLevelOf', () => {
  const catalogue = parseStyles(
    wrap(
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="MyHeading"><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Body"/>',
    ),
  )

  it('reads the level from the outline level, counting from one', () => {
    expect(headingLevelOf(catalogue, 'Heading3')).toBe(3)
  })

  it('recognises a custom style with an outline level', () => {
    expect(headingLevelOf(catalogue, 'MyHeading')).toBe(2)
  })

  it('returns null for a style that is not a heading', () => {
    expect(headingLevelOf(catalogue, 'Body')).toBeNull()
  })

  it('falls back to the style id when there is no outline level', () => {
    expect(headingLevelOf(parseStyles(wrap('')), 'Heading4')).toBe(4)
  })
})

describe('malformed input', () => {
  it('returns an empty catalogue instead of throwing', () => {
    expect(parseStyles('<nonsense/>').styles.size).toBe(0)
  })

  it('skips a style with no id', () => {
    expect(parseStyles(wrap('<w:style w:type="paragraph"/>')).styles.size).toBe(0)
  })
})

describe('real fixtures', () => {
  it('reads the style catalogue from a generated document', async () => {
    const pkg = await readPackage(await readFile(join(FIXTURES, 'headings.docx')))
    const catalogue = parseStyles(getPartText(pkg, STYLES_PART) ?? '')

    expect(catalogue.styles.size).toBeGreaterThan(5)
    expect(catalogue.defaultParagraphStyleId).not.toBeNull()
    expect(visibleParagraphStyles(catalogue).length).toBeGreaterThan(0)
  })

  it('resolves a heading style to something bigger than body text', async () => {
    const pkg = await readPackage(await readFile(join(FIXTURES, 'headings.docx')))
    const catalogue = parseStyles(getPartText(pkg, STYLES_PART) ?? '')

    const heading = resolveStyle(catalogue, 'Heading1')
    const normal = resolveStyle(catalogue, 'Normal')
    expect(heading.fontSize ?? 0).toBeGreaterThan(normal.fontSize ?? 0)
  })
})
