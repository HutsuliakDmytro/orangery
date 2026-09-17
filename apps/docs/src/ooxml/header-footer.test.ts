import { describe, expect, it } from 'vitest'
import {
  dateField,
  emptyPart,
  findReference,
  pageNumberField,
  parseReferences,
  partParagraphs,
  rebuildPart,
} from './header-footer'
import { element, parseXml, serializeNode, tagName, textValue, children } from './xml'

const SECT_PRESERVED = [
  '<w:headerReference w:type="default" r:id="rId4"/>',
  '<w:headerReference w:type="first" r:id="rId5"/>',
  '<w:footerReference w:type="default" r:id="rId6"/>',
  '<w:cols w:num="1"/>',
]

describe('parseReferences', () => {
  it('reads header and footer references', () => {
    const references = parseReferences(SECT_PRESERVED)
    expect(references).toHaveLength(3)
  })

  it('records the kind and the relationship id', () => {
    const [first] = parseReferences(SECT_PRESERVED)
    expect(first?.kind).toBe('header')
    expect(first?.relationshipId).toBe('rId4')
  })

  it('distinguishes first-page and default parts', () => {
    const references = parseReferences(SECT_PRESERVED)
    expect(references.map((reference) => reference.type)).toEqual(['default', 'first', 'default'])
  })

  it('treats a missing type as default, as Word does', () => {
    expect(parseReferences(['<w:headerReference r:id="rId9"/>'])[0]?.type).toBe('default')
  })

  it('skips a reference with no relationship id', () => {
    expect(parseReferences(['<w:headerReference w:type="default"/>'])).toEqual([])
  })

  it('ignores other section properties', () => {
    expect(parseReferences(['<w:cols w:num="2"/>'])).toEqual([])
  })
})

describe('findReference', () => {
  const references = parseReferences(SECT_PRESERVED)

  it('finds the default header', () => {
    expect(findReference(references, 'header')?.relationshipId).toBe('rId4')
  })

  it('finds a specific type', () => {
    expect(findReference(references, 'header', 'first')?.relationshipId).toBe('rId5')
  })

  it('returns undefined when there is none of that kind', () => {
    expect(findReference(references, 'footer', 'even')).toBeUndefined()
  })
})

describe('field construction', () => {
  const xml = (nodes: ReturnType<typeof pageNumberField>) => nodes.map(serializeNode).join('')

  it('writes a page field as the begin/instr/separate/end sequence Word expects', () => {
    const field = xml(pageNumberField())
    expect(field).toContain('w:fldCharType="begin"')
    expect(field).toContain(' PAGE ')
    expect(field).toContain('w:fldCharType="separate"')
    expect(field).toContain('w:fldCharType="end"')
  })

  it('caches a result so readers that do not evaluate fields show something', () => {
    expect(xml(pageNumberField('7'))).toContain('<w:t>7</w:t>')
  })

  it('writes a date field with its format switch', () => {
    // The builder escapes the quotes as `&quot;`, which is valid XML and decodes
    // to the same field code; the assertion is on meaning, not on bytes.
    const decoded = xml(dateField('d MMMM yyyy')).replaceAll('&quot;', '"')
    expect(decoded).toContain('DATE \\@ "d MMMM yyyy"')
  })

  it('preserves the space around the field code', () => {
    expect(xml(pageNumberField())).toContain('xml:space="preserve"')
  })
})

describe('part construction', () => {
  it('builds an empty header with the namespaces Word requires', () => {
    const part = emptyPart('header')
    expect(part).toContain('<w:hdr')
    expect(part).toContain('wordprocessingml/2006/main')
  })

  it('builds an empty footer with the footer root', () => {
    expect(emptyPart('footer')).toContain('<w:ftr')
  })

  it('starts with one paragraph, which Word requires', () => {
    expect(partParagraphs(emptyPart('header'))).toHaveLength(1)
  })
})

describe('partParagraphs', () => {
  it('reads the paragraphs of a header', () => {
    const part = '<w:hdr xmlns:w="x"><w:p><w:r><w:t>Title</w:t></w:r></w:p><w:p/></w:hdr>'
    expect(partParagraphs(part)).toHaveLength(2)
  })

  it('returns nothing for a part with no recognised root', () => {
    expect(partParagraphs('<nonsense/>')).toEqual([])
  })
})

describe('rebuildPart', () => {
  it('replaces the paragraphs', () => {
    const part = '<w:hdr xmlns:w="x"><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:hdr>'
    const rebuilt = rebuildPart(
      part,
      [element('w:p', {}, [element('w:r', {}, [element('w:t', {}, [{ '#text': 'New' }])])])],
      'header',
    )

    expect(rebuilt).toContain('New')
    expect(rebuilt).not.toContain('Old')
  })

  it('keeps non-paragraph children', () => {
    const part = '<w:hdr xmlns:w="x"><w:p/><w:sdt><w:sdtContent/></w:sdt></w:hdr>'
    expect(rebuildPart(part, [element('w:p')], 'header')).toContain('w:sdt')
  })

  it('keeps the root attributes', () => {
    const part = '<w:hdr xmlns:w="main" xmlns:r="rels"><w:p/></w:hdr>'
    const rebuilt = rebuildPart(part, [element('w:p')], 'header')

    expect(rebuilt).toContain('xmlns:w="main"')
    expect(rebuilt).toContain('xmlns:r="rels"')
  })

  it('falls back to a fresh part when the input has no root', () => {
    const rebuilt = rebuildPart('<nonsense/>', [element('w:p')], 'footer')
    expect(rebuilt).toContain('<w:ftr')
  })

  it('produces a part the reader accepts back', () => {
    const rebuilt = rebuildPart(
      emptyPart('header'),
      [element('w:p', {}, [element('w:r', {}, [element('w:t', {}, [{ '#text': 'Hi' }])])])],
      'header',
    )

    const paragraphs = partParagraphs(rebuilt)
    expect(paragraphs).toHaveLength(1)

    const [paragraph] = paragraphs
    const run = paragraph ? children(paragraph)[0] : undefined
    const text = run ? children(run)[0] : undefined
    const value = text ? children(text)[0] : undefined

    expect(tagName(run ?? {})).toBe('w:r')
    expect(value && textValue(value)).toBe('Hi')
  })
})

describe('field round-trip', () => {
  it('survives being parsed and written back', () => {
    const field = pageNumberField('3').map(serializeNode).join('')
    const reparsed = parseXml(field).map(serializeNode).join('')
    expect(reparsed).toBe(field)
  })
})
