import { describe, expect, it } from 'vitest'
import { compareXml, describeDifferences } from './compare'
import { parseThemeFonts } from './fonts'
import { parseDocument } from './parse-document'
import { stripDeclaration } from './xml'
import { serializeParsed } from './serialize-document'

const THEME = parseThemeFonts(
  `<a:theme xmlns:a="x"><a:themeElements><a:fontScheme>
     <a:majorFont><a:latin typeface="Cambria"/></a:majorFont>
     <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
   </a:fontScheme></a:themeElements></a:theme>`,
)

function wrap(body: string): string {
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

describe('theme fonts', () => {
  const xml = wrap(
    '<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr><w:t>x</w:t></w:r></w:p>',
  )

  it('resolves a theme slot to the family for display', () => {
    const { doc } = parseDocument(xml, { theme: THEME })
    const textStyle = doc.content?.[0]?.content?.[0]?.marks?.find((m) => m.type === 'textStyle')
    expect(textStyle?.attrs?.['fontFamily']).toBe('Calibri')
  })

  it('writes the theme reference back, not the resolved family', () => {
    const rewritten = serializeParsed(parseDocument(xml, { theme: THEME }))

    // `w:asciiTheme="Calibri"` would be invalid OOXML: the attribute takes a
    // theme slot name, never a font family.
    expect(rewritten).not.toContain('w:asciiTheme="Calibri"')
    expect(rewritten).toContain('w:asciiTheme="minorHAnsi"')
  })

  it('round-trips a theme-font run unchanged', () => {
    const rewritten = serializeParsed(parseDocument(xml, { theme: THEME }))
    expect(describeDifferences(compareXml(xml, stripDeclaration(rewritten)))).toBe('no differences')
  })

  it('still round-trips when no theme is supplied', () => {
    const rewritten = serializeParsed(parseDocument(xml))
    expect(describeDifferences(compareXml(xml, stripDeclaration(rewritten)))).toBe('no differences')
  })

  it('writes a direct family when the user changes the font', () => {
    const parsed = parseDocument(xml, { theme: THEME })
    const mark = parsed.doc.content?.[0]?.content?.[0]?.marks?.find((m) => m.type === 'textStyle')
    if (mark?.attrs) mark.attrs['fontFamily'] = 'Georgia'

    const rewritten = serializeParsed(parsed)
    expect(rewritten).toContain('Georgia')
    expect(rewritten).not.toContain('minorHAnsi')
  })
})
