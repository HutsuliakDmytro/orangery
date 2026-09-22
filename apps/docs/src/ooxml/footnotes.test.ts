import { serializeNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import {
  footnoteParagraph,
  footnoteReferenceRun,
  footnoteText,
  isRealFootnote,
  nextFootnoteId,
  parseFootnotes,
  RESERVED_FOOTNOTE_IDS,
  separatorFootnotes,
  serializeFootnotes,
} from './footnotes'

const PART = `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p><w:r><w:t>First note</w:t></w:r></w:p></w:footnote>
<w:footnote w:id="2"><w:p><w:r><w:t>Second note</w:t></w:r></w:p></w:footnote>
</w:footnotes>`

describe('parseFootnotes', () => {
  it('reads every entry, separators included', () => {
    expect(parseFootnotes(PART).size).toBe(4)
  })

  it('records the type of the separator entries', () => {
    expect(parseFootnotes(PART).get(-1)?.type).toBe('separator')
    expect(parseFootnotes(PART).get(0)?.type).toBe('continuationSeparator')
  })

  it('leaves the type null for a real note', () => {
    expect(parseFootnotes(PART).get(1)?.type).toBeNull()
  })

  it('skips an entry with no id', () => {
    expect(parseFootnotes('<w:footnotes><w:footnote/></w:footnotes>').size).toBe(0)
  })

  it('returns an empty map for malformed input', () => {
    expect(parseFootnotes('<nonsense/>').size).toBe(0)
  })
})

describe('isRealFootnote', () => {
  const footnotes = parseFootnotes(PART)

  it('rejects the separator entries', () => {
    expect(isRealFootnote(footnotes.get(-1) as never)).toBe(false)
    expect(isRealFootnote(footnotes.get(0) as never)).toBe(false)
  })

  it('accepts a real note', () => {
    expect(isRealFootnote(footnotes.get(1) as never)).toBe(true)
  })

  it('knows which ids are reserved', () => {
    expect([...RESERVED_FOOTNOTE_IDS].sort()).toEqual([-1, 0])
  })
})

describe('serializeFootnotes', () => {
  it('round-trips what it read', () => {
    const first = parseFootnotes(PART)
    const second = parseFootnotes(serializeFootnotes(first))

    expect([...second.keys()].sort((a, b) => a - b)).toEqual([-1, 0, 1, 2])
    expect(second.get(1)?.type).toBeNull()
  })

  it('writes separators before notes, in id order', () => {
    const xml = serializeFootnotes(parseFootnotes(PART))
    expect(xml.indexOf('w:id="-1"')).toBeLessThan(xml.indexOf('w:id="1"'))
  })

  it('keeps the note text', () => {
    expect(serializeFootnotes(parseFootnotes(PART))).toContain('First note')
  })

  it('gives an empty note a paragraph, which Word requires', () => {
    const footnotes = new Map([[1, { id: 1, type: null, paragraphs: [] }]])
    expect(serializeFootnotes(footnotes)).toContain('<w:p/>')
  })
})

describe('nextFootnoteId', () => {
  it('skips ids already in use', () => {
    expect(nextFootnoteId(parseFootnotes(PART))).toBe(3)
  })

  it('starts at one, past the reserved ids', () => {
    expect(nextFootnoteId(separatorFootnotes())).toBe(1)
  })

  it('fills a gap left by a deleted note', () => {
    const footnotes = parseFootnotes(PART)
    footnotes.delete(1)
    expect(nextFootnoteId(footnotes)).toBe(1)
  })
})

describe('separatorFootnotes', () => {
  it('produces the two entries Word expects', () => {
    const separators = separatorFootnotes()
    expect([...separators.keys()].sort((a, b) => a - b)).toEqual([-1, 0])
  })

  it('produces a part the parser reads back', () => {
    const reparsed = parseFootnotes(serializeFootnotes(separatorFootnotes()))
    expect(reparsed.get(-1)?.type).toBe('separator')
  })
})

describe('body markup', () => {
  it('writes a reference run with the footnote character style', () => {
    const xml = serializeNode(footnoteReferenceRun(3))
    expect(xml).toContain('w:footnoteReference w:id="3"')
    expect(xml).toContain('FootnoteReference')
  })

  it('writes a note paragraph with the marker and the text', () => {
    const xml = serializeNode(footnoteParagraph('See page 4'))
    expect(xml).toContain('w:footnoteRef')
    expect(xml).toContain('See page 4')
    expect(xml).toContain('FootnoteText')
  })

  it('keeps the space between the marker and the text', () => {
    expect(serializeNode(footnoteParagraph('x'))).toContain('xml:space="preserve"')
  })
})

describe('footnoteText', () => {
  it('reads the text of a note', () => {
    const footnotes = parseFootnotes(PART)
    expect(footnoteText(footnotes.get(1) as never)).toBe('First note')
  })

  it('joins multiple paragraphs with newlines', () => {
    const multi = parseFootnotes(
      '<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:footnote></w:footnotes>',
    )
    expect(footnoteText(multi.get(1) as never)).toBe('One\nTwo')
  })

  it('returns an empty string for a note with no text', () => {
    const empty = parseFootnotes(
      '<w:footnotes><w:footnote w:id="1"><w:p/></w:footnote></w:footnotes>',
    )
    expect(footnoteText(empty.get(1) as never)).toBe('')
  })
})

/**
 * The root of a part Word wrote, kept.
 *
 * Word declares a dozen namespaces on `w:footnotes` because a footnote may
 * hold VML, an OLE object or an equation. The writer knew about two of them,
 * so a saved file lost the rest — and a footnote using one of those prefixes
 * would have been written as XML with an undeclared prefix, which is a file
 * Word refuses to open. Ten files in the public corpus, 507 in the full one.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/5
 */
describe('a footnotes part that already exists', () => {
  const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const previous =
    `<?xml version='1.0' encoding='utf-8' standalone='yes'?>\n` +
    `<w:footnotes xmlns:w="${WORD}" xmlns:v="urn:schemas-microsoft-com:vml" ` +
    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">` +
    `<w:footnote w:id="1"><w:p/></w:footnote></w:footnotes>`

  it('keeps every namespace it declared', () => {
    const written = serializeFootnotes(parseFootnotes(previous), previous)

    for (const namespace of ['xmlns:v', 'xmlns:o', 'xmlns:m', 'xmlns:w']) {
      expect(written).toContain(namespace)
    }
  })

  it('keeps the declaration the file was written with', () => {
    const written = serializeFootnotes(parseFootnotes(previous), previous)

    expect(written.startsWith(`<?xml version='1.0' encoding='utf-8' standalone='yes'?>\n`)).toBe(
      true,
    )
  })

  it('still writes a whole part when there was not one before', () => {
    const written = serializeFootnotes(parseFootnotes(previous))

    expect(written).toContain('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    expect(written).toContain(`xmlns:w="${WORD}"`)
  })
})
