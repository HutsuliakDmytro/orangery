import { describe, expect, it } from 'vitest'
import { parseStyles } from '../ooxml/styles'
import type { DocumentStyle, StyleCatalogue } from '../ooxml/styles'
import { buildCharacterOptions, buildOptions } from './styles-store'

function catalogue(body: string) {
  return parseStyles(
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:styles>`,
  )
}

const style = (id: string, name: string, extra = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`

describe('buildOptions', () => {
  it('returns nothing without a catalogue', () => {
    expect(buildOptions(null)).toEqual([])
  })

  it("lists the document's own styles", () => {
    const options = buildOptions(catalogue(style('Normal', 'Normal') + style('Quote', 'Quote')))
    expect(options.map((option) => option.id)).toContain('Quote')
  })

  it("puts the familiar styles first, in Word's order", () => {
    const options = buildOptions(
      catalogue(
        style('Quote', 'Quote') +
          style('Heading1', 'heading 1') +
          style('Normal', 'Normal') +
          style('Title', 'Title'),
      ),
    )
    expect(options.slice(0, 3).map((option) => option.id)).toEqual(['Normal', 'Title', 'Heading1'])
  })

  it('sorts the rest alphabetically by display name', () => {
    const options = buildOptions(catalogue(style('Zed', 'Zed body') + style('Alpha', 'Alpha body')))
    expect(options.map((option) => option.label)).toEqual(['Alpha body', 'Zed body'])
  })

  it('shows the display name, not the style id', () => {
    const options = buildOptions(catalogue(style('Heading1', 'heading 1')))
    expect(options[0]?.label).toBe('heading 1')
  })

  it('marks which styles are headings', () => {
    const options = buildOptions(
      catalogue(
        style('Heading2', 'heading 2', '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>') +
          style('Quote', 'Quote'),
      ),
    )
    expect(options.find((option) => option.id === 'Heading2')?.headingLevel).toBe(2)
    expect(options.find((option) => option.id === 'Quote')?.headingLevel).toBeNull()
  })

  it('recognises a custom style with an outline level as a heading', () => {
    const options = buildOptions(
      catalogue(style('ChapterTitle', 'Chapter', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>')),
    )
    expect(options[0]?.headingLevel).toBe(1)
  })

  it('omits styles Word hides from its own gallery', () => {
    const options = buildOptions(
      catalogue(style('Normal', 'Normal') + style('Hidden', 'Hidden', '<w:semiHidden/>')),
    )
    expect(options.map((option) => option.id)).not.toContain('Hidden')
  })
})

describe('buildCharacterOptions', () => {
  const catalogue = (styles: DocumentStyle[]): StyleCatalogue => ({
    styles: new Map(styles.map((style) => [style.id, style])),
    defaults: {},
    defaultParagraphStyleId: null,
  })

  const style = (id: string, overrides: Partial<DocumentStyle> = {}): DocumentStyle => ({
    id,
    type: 'character',
    name: id,
    basedOn: null,
    next: null,
    isDefault: false,
    hidden: false,
    own: {},
    ...overrides,
  })

  it('offers the character styles a document defines', () => {
    const options = buildCharacterOptions(catalogue([style('Emphasis'), style('Strong')]))
    expect(options.map((option) => option.id)).toEqual(['Emphasis', 'Strong'])
  })

  it('leaves out the paragraph styles', () => {
    const options = buildCharacterOptions(
      catalogue([style('Emphasis'), style('Heading1', { type: 'paragraph' })]),
    )
    expect(options.map((option) => option.id)).toEqual(['Emphasis'])
  })

  it('leaves out the one that means no style at all', () => {
    // Word keeps `DefaultParagraphFont` out of its own gallery: offering it
    // would look like a style that does nothing, because it is.
    expect(buildCharacterOptions(catalogue([style('DefaultParagraphFont')]))).toEqual([])
  })

  it('leaves out the ones the document hides', () => {
    expect(buildCharacterOptions(catalogue([style('Internal', { hidden: true })]))).toEqual([])
  })

  it('has nothing to offer without a catalogue', () => {
    expect(buildCharacterOptions(null)).toEqual([])
  })
})
