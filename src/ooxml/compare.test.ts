import { describe, expect, it } from 'vitest'
import { compareXml, describeDifferences } from './compare'

const same = (a: string, b: string) => describeDifferences(compareXml(a, b)) === 'no differences'

describe('what is ignored', () => {
  it('ignores revision-save ids, which Word varies between saves', () => {
    expect(same('<w:p w:rsidR="001"><w:r/></w:p>', '<w:p w:rsidR="999"><w:r/></w:p>')).toBe(true)
  })

  it('ignores paragraph ids', () => {
    expect(same('<w:p w14:paraId="A"/>', '<w:p w14:paraId="B"/>')).toBe(true)
  })

  it('ignores attribute order', () => {
    expect(same('<w:sz w:val="24" w:x="1"/>', '<w:sz w:x="1" w:val="24"/>')).toBe(true)
  })

  it('treats an empty w:pPr as absent, since it states no properties', () => {
    expect(same('<w:p><w:pPr/><w:r/></w:p>', '<w:p><w:r/></w:p>')).toBe(true)
  })

  it('treats other empty property containers the same way', () => {
    expect(same('<w:r><w:rPr/><w:t>x</w:t></w:r>', '<w:r><w:t>x</w:t></w:r>')).toBe(true)
    expect(same('<w:tc><w:tcPr/><w:p/></w:tc>', '<w:tc><w:p/></w:tc>')).toBe(true)
  })

  it('ignores zero-length text nodes', () => {
    expect(same('<w:p><w:r/></w:p>', '<w:p><w:r/></w:p>')).toBe(true)
  })
})

describe('what is not ignored', () => {
  it('reports a property container that actually has content', () => {
    expect(same('<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>', '<w:p/>')).toBe(false)
  })

  it('reports a changed attribute value', () => {
    expect(same('<w:sz w:val="24"/>', '<w:sz w:val="28"/>')).toBe(false)
  })

  it('reports a changed element name', () => {
    expect(same('<w:b/>', '<w:i/>')).toBe(false)
  })

  it('reports changed text', () => {
    expect(same('<w:t>one</w:t>', '<w:t>two</w:t>')).toBe(false)
  })

  it('reports a missing child', () => {
    const two = '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>'
    const one = '<w:p><w:r><w:t>a</w:t></w:r></w:p>'
    expect(same(two, one)).toBe(false)
  })

  it('ignores a run that states formatting for no content', () => {
    // Writers emit these as a side effect of editing history; they render
    // nothing, so reproducing them would add a concept with no user meaning.
    expect(same('<w:p><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>', '<w:p/>')).toBe(true)
  })

  it('does not ignore a run that holds a break', () => {
    expect(same('<w:p><w:r><w:br/></w:r></w:p>', '<w:p/>')).toBe(false)
  })

  it('reports an added attribute', () => {
    expect(same('<w:rFonts w:ascii="Arial"/>', '<w:rFonts w:ascii="Arial" w:cs="Arial"/>')).toBe(
      false,
    )
  })

  it('reports changed child order', () => {
    expect(same('<w:p><w:b/><w:i/></w:p>', '<w:p><w:i/><w:b/></w:p>')).toBe(false)
  })

  it('reports whitespace between elements rather than ignoring it', () => {
    // Deliberately strict: whitespace inside `w:t` is significant, and the
    // comparison cannot tell the two positions apart without parsing context.
    // Being strict risks a noisy failure; being lax risks losing a user's spaces.
    expect(same('<w:p>\n  <w:r/>\n</w:p>', '<w:p><w:r/></w:p>')).toBe(false)
  })
})

describe('describeDifferences', () => {
  it('reports the path of the first divergence', () => {
    const differences = compareXml(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>b</w:t></w:r></w:p>',
    )
    expect(describeDifferences(differences)).toContain('w:p')
  })

  it('caps how many it lists', () => {
    const left = `<w:p>${'<w:r><w:t>a</w:t></w:r>'.repeat(20)}</w:p>`
    const right = `<w:p>${'<w:r><w:t>b</w:t></w:r>'.repeat(20)}</w:p>`
    expect(describeDifferences(compareXml(left, right)).split('\n')).toHaveLength(5)
  })

  it('says so plainly when there is nothing to report', () => {
    expect(describeDifferences([])).toBe('no differences')
  })
})
