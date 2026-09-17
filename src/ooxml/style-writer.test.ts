import { describe, expect, it } from 'vitest'
import { parseStyles } from './styles'
import { buildStyle, freeStyleId, upsertStyle } from './style-writer'
import { serializeNode } from './xml'

const EMPTY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`

const definition = (overrides = {}) => ({
  id: 'Quote',
  name: 'Quote',
  type: 'paragraph' as const,
  basedOn: 'Normal',
  next: 'Normal',
  formatting: {},
  ...overrides,
})

describe('buildStyle', () => {
  it('states the run formatting', () => {
    const xml = serializeNode(
      buildStyle(definition({ formatting: { bold: true, fontSize: 14, color: '#FF0000' } })),
    )

    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:sz w:val="28"/>')
    expect(xml).toContain('<w:color w:val="FF0000"/>')
  })

  it('states the paragraph formatting', () => {
    const xml = serializeNode(
      buildStyle(
        definition({ formatting: { textAlign: 'justify', spaceAfter: 6, indentFirstLine: 18 } }),
      ),
    )

    // OOXML calls justified `both`.
    expect(xml).toContain('<w:jc w:val="both"/>')
    expect(xml).toContain('w:after="120"')
    expect(xml).toContain('w:firstLine="360"')
  })

  it('writes a negative first line as a hanging indent', () => {
    const xml = serializeNode(buildStyle(definition({ formatting: { indentFirstLine: -18 } })))
    expect(xml).toContain('w:hanging="360"')
  })

  it('puts the style in the gallery, so it can be found again', () => {
    expect(serializeNode(buildStyle(definition()))).toContain('<w:qFormat/>')
  })

  it('leaves the paragraph properties off a character style', () => {
    const xml = serializeNode(
      buildStyle(definition({ type: 'character', formatting: { bold: true, textAlign: 'center' } })),
    )

    expect(xml).toContain('<w:b/>')
    expect(xml).not.toContain('w:jc')
  })
})

describe('upsertStyle', () => {
  it('adds a style the file does not have', () => {
    const catalogue = parseStyles(upsertStyle(EMPTY, definition()))
    expect(catalogue.styles.get('Quote')?.name).toBe('Quote')
  })

  it('replaces one with the same id rather than adding a second', () => {
    // Two styles sharing an id is a file Word repairs.
    const once = upsertStyle(EMPTY, definition({ formatting: { bold: true } }))
    const twice = upsertStyle(once, definition({ formatting: { italic: true } }))

    expect(twice.match(/w:styleId="Quote"/gu)).toHaveLength(1)
    expect(parseStyles(twice).styles.get('Quote')?.own.italic).toBe(true)
    expect(parseStyles(twice).styles.get('Quote')?.own.bold).toBeUndefined()
  })

  it('leaves the styles already there alone', () => {
    expect(parseStyles(upsertStyle(EMPTY, definition())).styles.get('Normal')).toBeDefined()
  })

  it('round-trips through the reader', () => {
    const xml = upsertStyle(
      EMPTY,
      definition({ formatting: { bold: true, fontSize: 12, textAlign: 'center' } }),
    )
    const style = parseStyles(xml).styles.get('Quote')

    expect(style?.basedOn).toBe('Normal')
    expect(style?.own.bold).toBe(true)
    expect(style?.own.fontSize).toBe(12)
    expect(style?.own.textAlign).toBe('center')
  })

  it('leaves a file it cannot understand as it found it', () => {
    expect(upsertStyle('<nonsense/>', definition())).toBe('<nonsense/>')
  })
})

describe('freeStyleId', () => {
  it('makes an id out of the name', () => {
    expect(freeStyleId(EMPTY, 'Pull Quote')).toBe('PullQuote')
  })

  it('does not hand out one already taken', () => {
    expect(freeStyleId(EMPTY, 'Normal')).toBe('Normal1')
  })

  it('falls back when the name has nothing an id can use', () => {
    expect(freeStyleId(EMPTY, '— —')).toBe('Style')
  })
})
