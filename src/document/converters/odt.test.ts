import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { textContentOf } from './types'
import {
  openOdt,
  parseOdtContent,
  parseOdtListStyles,
  saveOdt,
  serializeOdtContent,
} from './odt'

const CONTENT = (body: string, styles = '') => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:automatic-styles>${styles}</office:automatic-styles>
<office:body><office:text>${body}</office:text></office:body>
</office:document-content>`

async function packageOf(content: string, styles = '<office:document-styles/>'): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
  zip.file('content.xml', content)
  zip.file('styles.xml', styles)
  zip.file('META-INF/manifest.xml', '<manifest:manifest/>')
  return zip.generateAsync({ type: 'uint8array' })
}

const STYLES = (listStyles: string) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0">
<office:styles>${listStyles}</office:styles>
</office:document-styles>`

const NUMBERED = `<text:list-style style:name="WWNum1">
  <text:list-level-style-number text:level="1" style:num-format="1"/>
  <text:list-level-style-number text:level="2" style:num-format="a"/>
</text:list-style>`

describe('list styles', () => {
  it('reads the kind from the list style rather than its name', () => {
    const { doc } = parseOdtContent(
      CONTENT('<text:list text:style-name="WWNum1"><text:list-item><text:p>one</text:p></text:list-item></text:list>'),
      { listStyles: parseOdtListStyles(STYLES(NUMBERED)) },
    )

    expect(doc.content?.[0]?.type).toBe('orderedList')
  })

  it('reads a bulleted style declared with the same shape of name', () => {
    const bullet = `<text:list-style style:name="WWNum1"><text:list-level-style-bullet text:level="1" text:bullet-char="\u2022"/></text:list-style>`

    const { doc } = parseOdtContent(
      CONTENT('<text:list text:style-name="WWNum1"><text:list-item><text:p>one</text:p></text:list-item></text:list>'),
      { listStyles: parseOdtListStyles(STYLES(bullet)) },
    )

    expect(doc.content?.[0]?.type).toBe('bulletList')
  })

  it('takes a nested list kind from the level it sits at', () => {
    const mixed = `<text:list-style style:name="L1">
      <text:list-level-style-bullet text:level="1" text:bullet-char="\u2022"/>
      <text:list-level-style-number text:level="2" style:num-format="1"/>
    </text:list-style>`

    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list text:style-name="L1"><text:list-item><text:p>one</text:p>' +
          '<text:list><text:list-item><text:p>deep</text:p></text:list-item></text:list>' +
          '</text:list-item></text:list>',
      ),
      { listStyles: parseOdtListStyles(STYLES(mixed)) },
    )

    const outer = doc.content?.[0]
    expect(outer?.type).toBe('bulletList')
    expect(outer?.content?.[0]?.content?.[1]?.type).toBe('orderedList')
  })

  it('treats a level with no number format as unmarked rather than numbered', () => {
    const none = `<text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format=""/></text:list-style>`

    const { doc } = parseOdtContent(
      CONTENT('<text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item></text:list>'),
      { listStyles: parseOdtListStyles(STYLES(none)) },
    )

    expect(doc.content?.[0]?.type).toBe('bulletList')
  })

  it('repeats the deepest declared level for lists nested past it', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list text:style-name="WWNum1"><text:list-item>' +
          '<text:list><text:list-item><text:list><text:list-item><text:p>deep</text:p></text:list-item></text:list></text:list-item></text:list>' +
          '</text:list-item></text:list>',
      ),
      { listStyles: parseOdtListStyles(STYLES(NUMBERED)) },
    )

    const second = doc.content?.[0]?.content?.[0]?.content?.[0]
    expect(second?.content?.[0]?.content?.[0]?.type).toBe('orderedList')
  })

  it('prefers a list style redeclared in content.xml', () => {
    const inContent = `<text:list-style style:name="WWNum1"><text:list-level-style-bullet text:level="1" text:bullet-char="\u2022"/></text:list-style>`

    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list text:style-name="WWNum1"><text:list-item><text:p>one</text:p></text:list-item></text:list>',
        inContent,
      ),
      { listStyles: parseOdtListStyles(STYLES(NUMBERED)) },
    )

    expect(doc.content?.[0]?.type).toBe('bulletList')
  })

  it('falls back to the name when nothing in the package declares the style', () => {
    const { doc } = parseOdtContent(
      CONTENT('<text:list text:style-name="WWNum1"><text:list-item><text:p>one</text:p></text:list-item></text:list>'),
    )

    expect(doc.content?.[0]?.type).toBe('orderedList')
  })

  it('reads a start value off the first item', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list text:style-name="WWNum1"><text:list-item text:start-value="5"><text:p>five</text:p></text:list-item></text:list>',
      ),
      { listStyles: parseOdtListStyles(STYLES(NUMBERED)) },
    )

    expect(doc.content?.[0]?.attrs?.['start']).toBe(5)
  })

  it('keeps the text of a list header instead of dropping it', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list text:style-name="L1"><text:list-header><text:p>intro</text:p></text:list-header>' +
          '<text:list-item><text:p>one</text:p></text:list-item></text:list>',
      ),
    )

    expect(textContentOf(doc)).toContain('intro')
  })

  it('declares the list style it references on export', () => {
    const xml = serializeOdtContent(
      {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
          },
        ],
      },
      { contentAttributes: {} },
    )

    expect(xml).toContain('<text:list-style style:name="OD_Number"')
    expect(xml).toContain('text:style-name="OD_Number"')
    expect(xml).toContain('text:start-value="3"')
  })

  it('round-trips a numbered list as numbered', () => {
    const first = serializeOdtContent(
      {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
              },
            ],
          },
        ],
      },
      { contentAttributes: {} },
    )

    expect(parseOdtContent(first).doc.content?.[0]?.type).toBe('orderedList')
  })
})

describe('parseOdtContent', () => {
  it('reads paragraphs', () => {
    const { doc } = parseOdtContent(CONTENT('<text:p>hello</text:p>'))
    expect(doc.content?.[0]?.type).toBe('paragraph')
    expect(textContentOf(doc)).toBe('hello')
  })

  it('reads headings and their level', () => {
    const { doc } = parseOdtContent(CONTENT('<text:h text:outline-level="2">Section</text:h>'))
    expect(doc.content?.[0]?.type).toBe('heading')
    expect(doc.content?.[0]?.attrs?.['level']).toBe(2)
  })

  it('clamps an out-of-range outline level', () => {
    const { doc } = parseOdtContent(CONTENT('<text:h text:outline-level="9">x</text:h>'))
    expect(doc.content?.[0]?.attrs?.['level']).toBe(6)
  })

  it('resolves formatting through automatic styles', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:p><text:span text:style-name="T1">bold</text:span></text:p>',
        '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>',
      ),
    )
    const marks = (doc.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type)
    expect(marks).toContain('bold')
  })

  it('reads italic, underline and strike from a style', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:p><text:span text:style-name="T2">x</text:span></text:p>',
        '<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic" style:text-underline-style="solid" style:text-line-through-style="solid"/></style:style>',
      ),
    )
    const marks = (doc.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type)
    expect(marks).toEqual(expect.arrayContaining(['italic', 'underline', 'strike']))
  })

  it('expands an explicit run of spaces', () => {
    const { doc } = parseOdtContent(CONTENT('<text:p>a<text:s text:c="3"/>b</text:p>'))
    expect(textContentOf(doc)).toBe('a   b')
  })

  it('reads tabs and line breaks', () => {
    const { doc } = parseOdtContent(CONTENT('<text:p>a<text:tab/>b<text:line-break/></text:p>'))
    expect(textContentOf(doc)).toBe('a\tb')
    expect(JSON.stringify(doc)).toContain('hardBreak')
  })

  it('reads a hyperlink and keeps its target', () => {
    const { doc } = parseOdtContent(
      CONTENT('<text:p><text:a xlink:href="https://example.com">x</text:a></text:p>'),
    )
    expect(JSON.stringify(doc)).toContain('https://example.com')
  })

  it('preserves an unknown block and warns', () => {
    const { doc, warnings } = parseOdtContent(CONTENT('<draw:frame><draw:image/></draw:frame>'))
    expect(doc.content?.[0]?.type).toBe('passthroughBlock')
    expect(warnings.map((warning) => warning.tag)).toContain('draw:frame')
  })

  it('reads a list', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>',
      ),
    )
    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(doc.content?.[0]?.content).toHaveLength(2)
  })

  it('reads a nested list', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:list><text:list-item><text:p>one</text:p><text:list><text:list-item><text:p>deep</text:p></text:list-item></text:list></text:list-item></text:list>',
      ),
    )
    const item = doc.content?.[0]?.content?.[0]
    expect(item?.content?.[1]?.type).toBe('bulletList')
  })

  it('reads a table with its cells', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<table:table><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>',
      ),
    )
    expect(doc.content?.[0]?.type).toBe('table')
    expect(doc.content?.[0]?.content?.[0]?.content).toHaveLength(2)
  })

  it('reads cell spans', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<table:table><table:table-row><table:table-cell table:number-columns-spanned="2" table:number-rows-spanned="3"><text:p>wide</text:p></table:table-cell></table:table-row></table:table>',
      ),
    )
    const cell = doc.content?.[0]?.content?.[0]?.content?.[0]
    expect(cell?.attrs?.['colspan']).toBe(2)
    expect(cell?.attrs?.['rowspan']).toBe(3)
  })

  it('gives an empty cell a paragraph', () => {
    const { doc } = parseOdtContent(
      CONTENT('<table:table><table:table-row><table:table-cell/></table:table-row></table:table>'),
    )
    const cell = doc.content?.[0]?.content?.[0]?.content?.[0]
    expect(cell?.content?.[0]?.type).toBe('paragraph')
  })

  it('does not throw on a file with no document root', () => {
    const { warnings } = parseOdtContent('<nonsense/>')
    expect(warnings).toHaveLength(1)
  })
})

describe('serializeOdtContent', () => {
  const roundTrip = (content: string) => {
    const parsed = parseOdtContent(content)
    return parseOdtContent(
      serializeOdtContent(parsed.doc, { contentAttributes: parsed.contentAttributes }),
    )
  }

  it('round-trips paragraphs and headings', () => {
    const { doc } = roundTrip(
      CONTENT('<text:h text:outline-level="3">T</text:h><text:p>body</text:p>'),
    )
    expect(doc.content?.[0]?.attrs?.['level']).toBe(3)
    expect(textContentOf(doc)).toBe('Tbody')
  })

  it('round-trips formatting through regenerated styles', () => {
    const { doc } = roundTrip(
      CONTENT(
        '<text:p><text:span text:style-name="T1">bold</text:span></text:p>',
        '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>',
      ),
    )
    const marks = (doc.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type)
    expect(marks).toContain('bold')
  })

  it('round-trips a hyperlink', () => {
    const { doc } = roundTrip(
      CONTENT('<text:p><text:a xlink:href="https://example.com">x</text:a></text:p>'),
    )
    expect(JSON.stringify(doc)).toContain('https://example.com')
  })

  it('writes unknown blocks back verbatim', () => {
    const { doc } = roundTrip(CONTENT('<draw:frame><draw:image/></draw:frame>'))
    expect(doc.content?.[0]?.type).toBe('passthroughBlock')
  })

  it('round-trips a list', () => {
    const { doc } = roundTrip(
      CONTENT(
        '<text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item></text:list>',
      ),
    )
    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(textContentOf(doc)).toBe('one')
  })

  it('round-trips a table with a span', () => {
    const { doc } = roundTrip(
      CONTENT(
        '<table:table><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>wide</text:p></table:table-cell></table:table-row></table:table>',
      ),
    )
    const cell = doc.content?.[0]?.content?.[0]?.content?.[0]
    expect(cell?.attrs?.['colspan']).toBe(2)
    expect(textContentOf(doc)).toBe('wide')
  })

  it('declares only the styles the document uses', () => {
    const parsed = parseOdtContent(
      CONTENT(
        '<text:p><text:span text:style-name="T1">bold</text:span></text:p>',
        '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>',
      ),
    )
    const xml = serializeOdtContent(parsed.doc, { contentAttributes: parsed.contentAttributes })

    expect(xml).toContain('OD_B')
    expect(xml).not.toContain('OD_I')
  })
})

describe('package handling', () => {
  it('resolves a list style declared in styles.xml', async () => {
    const document = await openOdt(
      await packageOf(
        CONTENT(
          '<text:list text:style-name="WWNum1"><text:list-item><text:p>one</text:p></text:list-item></text:list>',
        ),
        STYLES(NUMBERED),
      ),
    )

    expect(document.doc.content?.[0]?.type).toBe('orderedList')
  })

  it('opens a package and reads its content', async () => {
    const document = await openOdt(await packageOf(CONTENT('<text:p>hello</text:p>')))
    expect(textContentOf(document.doc)).toBe('hello')
  })

  it('rejects a zip with no content.xml', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
    await expect(openOdt(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /content\.xml/u,
    )
  })

  it('keeps every other part on save', async () => {
    const document = await openOdt(await packageOf(CONTENT('<text:p>hello</text:p>')))
    const reopened = await JSZip.loadAsync(await saveOdt(document, document.doc))

    // JSZip synthesises directory entries; only files are part of the package.
    const files = Object.values(reopened.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort()

    expect(files).toEqual(['META-INF/manifest.xml', 'content.xml', 'mimetype', 'styles.xml'])
  })

  it('carries an edit through a save', async () => {
    const document = await openOdt(await packageOf(CONTENT('<text:p>hello</text:p>')))
    const edited = structuredClone(document.doc)
    const text = edited.content?.[0]?.content?.[0]
    if (text) text.text = 'changed'

    const reopened = await openOdt(await saveOdt(document, edited))
    expect(textContentOf(reopened.doc)).toBe('changed')
  })
})
