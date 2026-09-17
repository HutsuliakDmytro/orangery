import { describe, expect, it } from 'vitest'
import {
  attributesFor,
  hasProperties,
  NO_PARAGRAPH_PROPERTIES,
  propertiesOf,
} from './paragraph-properties'

describe('paragraph properties', () => {
  it('reads what a block carries', () => {
    const properties = propertiesOf({
      type: 'paragraph',
      attrs: { textAlign: 'center', indentLeft: 36, lineHeight: 1.5 },
    })

    expect(properties.textAlign).toBe('center')
    expect(properties.indentLeft).toBe(36)
    expect(properties.lineHeight).toBe(1.5)
    expect(properties.spaceAfter).toBeNull()
  })

  it('treats zero as no indent rather than an indent of nothing', () => {
    // Writing a zero out would override whatever the paragraph's style says.
    const properties = propertiesOf({ type: 'paragraph', attrs: { indentLeft: 0 } })
    expect(properties.indentLeft).toBeNull()
  })

  it('keeps a hanging indent, which is stated as a negative', () => {
    const properties = propertiesOf({ type: 'paragraph', attrs: { indentFirstLine: -18 } })
    expect(properties.indentFirstLine).toBe(-18)
  })

  it('round-trips through attributes', () => {
    const attrs = { textAlign: 'right', indentRight: 12, spaceBefore: 6 }
    expect(attributesFor(propertiesOf({ type: 'paragraph', attrs }))).toEqual(attrs)
  })

  it('says when a block has nothing of its own', () => {
    expect(hasProperties(NO_PARAGRAPH_PROPERTIES)).toBe(false)
    expect(hasProperties(propertiesOf({ type: 'paragraph', attrs: { spaceAfter: 6 } }))).toBe(true)
  })
})
