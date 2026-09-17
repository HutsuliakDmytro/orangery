import { serializeNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { buildTocField, fieldCode } from './toc-field'

const xmlOf = (nodes: ReturnType<typeof buildTocField>) => nodes.map(serializeNode).join('')

/** The builder escapes quotes as `&quot;`, which decodes to the same code. */
const decoded = (nodes: ReturnType<typeof buildTocField>) => xmlOf(nodes).replaceAll('&quot;', '"')

const entries = [
  { level: 1, text: 'Introduction' },
  { level: 2, text: 'Background' },
  { level: 1, text: 'Conclusion' },
]

describe('fieldCode', () => {
  it('includes the levels Word includes by default', () => {
    expect(fieldCode(3)).toContain('TOC \\o "1-3"')
  })

  it('carries the switches Word writes: hyperlinks, hidden leaders, outline levels', () => {
    expect(fieldCode(3)).toContain('\\h')
    expect(fieldCode(3)).toContain('\\z')
    expect(fieldCode(3)).toContain('\\u')
  })

  it('clamps the level to what OOXML allows', () => {
    expect(fieldCode(0)).toContain('"1-1"')
    expect(fieldCode(99)).toContain('"1-9"')
  })

  it('keeps the spaces around the code, which Word requires', () => {
    expect(fieldCode(3).startsWith(' ')).toBe(true)
    expect(fieldCode(3).endsWith(' ')).toBe(true)
  })
})

describe('buildTocField', () => {
  it('writes the field markers in order', () => {
    const xml = xmlOf(buildTocField(entries))
    expect(xml.indexOf('begin')).toBeLessThan(xml.indexOf('separate'))
    expect(xml.indexOf('separate')).toBeLessThan(xml.indexOf('"end"'))
  })

  it('opens the field in the first paragraph and closes it in the last', () => {
    const nodes = buildTocField(entries)
    expect(serializeNode(nodes[0] ?? {})).toContain('begin')
    expect(serializeNode(nodes[0] ?? {})).not.toContain('"end"')
    expect(serializeNode(nodes.at(-1) ?? {})).toContain('"end"')
  })

  it('writes one paragraph per entry', () => {
    expect(buildTocField(entries)).toHaveLength(3)
  })

  it('caches the entry text, so readers that do not evaluate fields show it', () => {
    const xml = xmlOf(buildTocField(entries))
    expect(xml).toContain('Introduction')
    expect(xml).toContain('Conclusion')
  })

  it('styles each entry by its level', () => {
    const xml = xmlOf(buildTocField(entries))
    expect(xml).toContain('w:val="TOC1"')
    expect(xml).toContain('w:val="TOC2"')
  })

  it('marks the field dirty so Word refreshes it on open', () => {
    expect(xmlOf(buildTocField(entries))).toContain('w:dirty="true"')
  })

  it('opens and closes in the same paragraph for a single entry', () => {
    const nodes = buildTocField([{ level: 1, text: 'Only' }])
    expect(nodes).toHaveLength(1)

    const xml = serializeNode(nodes[0] ?? {})
    expect(xml).toContain('begin')
    expect(xml).toContain('"end"')
    expect(xml.indexOf('Only')).toBeLessThan(xml.indexOf('"end"'))
  })

  it('still writes the field when there are no headings yet', () => {
    // A document with no headings is a normal state, not an error: the field
    // has to exist so Word can fill it in later.
    const xml = xmlOf(buildTocField([]))
    expect(xml).toContain('TOC')
    expect(xml).toContain('begin')
    expect(xml).toContain('"end"')
  })

  it('honours the level limit in the field code', () => {
    expect(decoded(buildTocField(entries, 1))).toContain('"1-1"')
  })

  it('writes the default range into the field code', () => {
    expect(decoded(buildTocField(entries))).toContain('TOC \\o "1-3"')
  })

  it('clamps an entry level beyond nine', () => {
    expect(xmlOf(buildTocField([{ level: 42, text: 'Deep' }]))).toContain('TOC9')
  })
})
