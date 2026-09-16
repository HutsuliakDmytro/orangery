import { describe, expect, it } from 'vitest'
import { emptyPart, partParagraphs, rebuildPart } from '../ooxml/header-footer'
import { serializeNode } from '../ooxml/xml'
import {
  DATE_TOKEN,
  PAGE_NUMBER_TOKEN,
  paragraphsFromText,
  textFromParagraphs,
} from './header-footer-text'

const roundTrip = (text: string) => textFromParagraphs(paragraphsFromText(text))

describe('paragraphsFromText', () => {
  it('builds one paragraph per line', () => {
    expect(paragraphsFromText('one\ntwo')).toHaveLength(2)
  })

  it('writes plain text as a run', () => {
    expect(serializeNode(paragraphsFromText('Confidential')[0] ?? {})).toContain('Confidential')
  })

  it('expands the page token into a PAGE field', () => {
    const xml = serializeNode(paragraphsFromText(`Page ${PAGE_NUMBER_TOKEN}`)[0] ?? {})
    expect(xml).toContain(' PAGE ')
    expect(xml).toContain('w:fldCharType="begin"')
  })

  it('expands the date token into a DATE field', () => {
    expect(serializeNode(paragraphsFromText(DATE_TOKEN)[0] ?? {})).toContain('DATE')
  })

  it('keeps the text around a token', () => {
    const xml = serializeNode(paragraphsFromText(`Page ${PAGE_NUMBER_TOKEN} of many`)[0] ?? {})
    expect(xml).toContain('Page ')
    expect(xml).toContain(' of many')
  })

  it('preserves the spaces around a token', () => {
    expect(serializeNode(paragraphsFromText(`a ${PAGE_NUMBER_TOKEN} b`)[0] ?? {})).toContain(
      'xml:space="preserve"',
    )
  })

  it('produces an empty paragraph for empty text', () => {
    expect(paragraphsFromText('')).toHaveLength(1)
  })
})

describe('textFromParagraphs', () => {
  it('reads plain text back', () => {
    expect(roundTrip('Confidential')).toBe('Confidential')
  })

  it('shows a PAGE field as its token', () => {
    expect(roundTrip(`Page ${PAGE_NUMBER_TOKEN}`)).toBe(`Page ${PAGE_NUMBER_TOKEN}`)
  })

  it('shows a DATE field as its token', () => {
    expect(roundTrip(`Printed ${DATE_TOKEN}`)).toBe(`Printed ${DATE_TOKEN}`)
  })

  it('does not show the cached field result as text', () => {
    // The field caches "1" so readers that cannot evaluate it show something;
    // that value must not turn into literal text in the editor.
    const text = roundTrip(PAGE_NUMBER_TOKEN)
    expect(text).toBe(PAGE_NUMBER_TOKEN)
    expect(text).not.toContain('1')
  })

  it('drops a field it does not recognise rather than showing its code', async () => {
    const xml =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> TOC \\o "1-3" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>cached</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'

    const { parseXml } = await import('../ooxml/xml')
    expect(textFromParagraphs(parseXml(xml))).toBe('')
  })

  it('reads multiple lines', () => {
    expect(roundTrip('one\ntwo')).toBe('one\ntwo')
  })

  it('returns an empty string for an empty part', () => {
    expect(textFromParagraphs(partParagraphs(emptyPart('header')))).toBe('')
  })
})

describe('with a real part', () => {
  it('survives being written into a part and read back', () => {
    const text = `Report — ${DATE_TOKEN} — page ${PAGE_NUMBER_TOKEN}`
    const part = rebuildPart(emptyPart('header'), paragraphsFromText(text), 'header')

    expect(textFromParagraphs(partParagraphs(part))).toBe(text)
  })
})
