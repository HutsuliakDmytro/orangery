import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'
import { textContentOf } from './types'
import {
  lengthToPoints,
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

describe('images', () => {
  const FRAME = (attributes: string, inner = '<draw:image xlink:href="Pictures/a.png"/>') =>
    `<text:p><draw:frame ${attributes}>${inner}</draw:frame></text:p>`

  it('converts frame lengths to points', () => {
    expect(lengthToPoints('1in')).toBe(72)
    expect(lengthToPoints('2.54cm')).toBe(72)
    expect(lengthToPoints('12pt')).toBe(12)
    expect(lengthToPoints('96px')).toBe(72)
    expect(lengthToPoints(undefined)).toBeNull()
    expect(lengthToPoints('wide')).toBeNull()
  })

  it('reads an inline picture with its size and alt text', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        FRAME(
          'text:anchor-type="as-char" svg:width="1in" svg:height="0.5in"',
          '<draw:image xlink:href="Pictures/a.png"/><svg:desc>A cat</svg:desc>',
        ),
      ),
    )

    const image = doc.content?.[0]?.content?.[0]
    expect(image?.type).toBe('image')
    expect(image?.attrs?.['width']).toBe(72)
    expect(image?.attrs?.['height']).toBe(36)
    expect(image?.attrs?.['alt']).toBe('A cat')
    expect(image?.attrs?.['wrap']).toBe('inline')
    expect(image?.attrs?.['href']).toBe('Pictures/a.png')
  })

  it('takes the wrap side from the frame style, inverted', () => {
    // `style:wrap="right"` lets text run down the right, so the picture is left.
    const { doc } = parseOdtContent(
      CONTENT(
        FRAME('text:anchor-type="paragraph" draw:style-name="fr1"'),
        '<style:style style:name="fr1" style:family="graphic"><style:graphic-properties style:wrap="right"/></style:style>',
      ),
    )

    expect(doc.content?.[0]?.content?.[0]?.attrs?.['wrap']).toBe('left')
  })

  it('preserves a frame drawn behind the text rather than moving it into the flow', () => {
    const { doc, warnings } = parseOdtContent(
      CONTENT(
        FRAME('text:anchor-type="paragraph" draw:style-name="fr1"'),
        '<style:style style:name="fr1" style:family="graphic"><style:graphic-properties style:wrap="run-through"/></style:style>',
      ),
    )

    expect(doc.content?.[0]?.content?.[0]?.type).toBe('passthroughInline')
    expect(warnings.some((warning) => warning.tag === 'draw:frame')).toBe(true)
  })

  it('preserves a frame that holds something other than a picture', () => {
    const { doc } = parseOdtContent(
      CONTENT(FRAME('text:anchor-type="as-char"', '<draw:text-box><text:p>x</text:p></draw:text-box>')),
    )

    expect(doc.content?.[0]?.content?.[0]?.type).toBe('passthroughInline')
  })

  it('preserves a linked picture, whose bytes are not in the package', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        FRAME('text:anchor-type="as-char"', '<draw:image xlink:href="https://example.com/a.png"/>'),
      ),
    )

    expect(doc.content?.[0]?.content?.[0]?.type).toBe('passthroughInline')
  })

  it('writes an untouched picture back unchanged', () => {
    const source = CONTENT(
      FRAME('draw:name="Image1" text:anchor-type="as-char" svg:width="1in" svg:height="0.5in"'),
    )

    const { doc } = parseOdtContent(source)
    const xml = serializeOdtContent(doc, { contentAttributes: {} })

    expect(xml).toContain('svg:width="1in"')
    expect(xml).toContain('xlink:href="Pictures/a.png"')
  })

  it('rebuilds the frame once the picture is resized', () => {
    const { doc } = parseOdtContent(
      CONTENT(FRAME('text:anchor-type="as-char" svg:width="1in" svg:height="0.5in"')),
    )

    const image = doc.content?.[0]?.content?.[0]
    if (image?.attrs) image.attrs['width'] = 144

    const xml = serializeOdtContent(doc, { contentAttributes: {} })
    expect(xml).toContain('svg:width="144pt"')
    expect(xml).not.toContain('svg:width="1in"')
  })

  it('declares a graphic style for a wrapped picture it writes', () => {
    const xml = serializeOdtContent(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'image', attrs: { href: 'Pictures/a.png', width: 72, wrap: 'left' } },
            ],
          },
        ],
      },
      { contentAttributes: {} },
    )

    expect(xml).toContain('style:name="OD_WrapLeft"')
    // Text runs down the right of a picture floated left.
    expect(xml).toContain('style:wrap="right"')
    expect(xml).toContain('text:anchor-type="paragraph"')
  })

  it('resolves picture bytes to a data URL when the package is opened', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
    zip.file('content.xml', CONTENT(FRAME('text:anchor-type="as-char" svg:width="1in"')))
    zip.file('styles.xml', '<office:document-styles/>')
    zip.file('Pictures/a.png', new Uint8Array([137, 80, 78, 71]))

    const document = await openOdt(await zip.generateAsync({ type: 'uint8array' }))
    const image = document.doc.content?.[0]?.content?.[0]

    expect(image?.attrs?.['src']).toBe('data:image/png;base64,iVBORw==')
  })

  it('keeps the picture bytes when the document is saved', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
    zip.file('content.xml', CONTENT(FRAME('text:anchor-type="as-char" svg:width="1in"')))
    zip.file('styles.xml', '<office:document-styles/>')
    zip.file('Pictures/a.png', new Uint8Array([137, 80, 78, 71]))

    const document = await openOdt(await zip.generateAsync({ type: 'uint8array' }))
    const saved = await JSZip.loadAsync(await saveOdt(document, document.doc))

    expect(saved.file('Pictures/a.png')).not.toBeNull()
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

    // One style for the one combination in use, and nothing else.
    expect(xml.match(/style:family="text"/gu)).toHaveLength(1)
    expect(xml).toContain('fo:font-weight="bold"')
    expect(xml).not.toContain('fo:font-style')
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

describe('odt character formatting', () => {
  const styled = (properties: string, name = 'T1') =>
    CONTENT(
      `<text:p><text:span text:style-name="${name}">text</text:span></text:p>`,
      `<style:style style:name="${name}" style:family="text"><style:text-properties ${properties}/></style:style>`,
    )

  const markOf = (doc: ProseMirrorNodeJson, type: string) =>
    doc.content?.[0]?.content?.[0]?.marks?.find((mark) => mark.type === type)

  it('reads colour, family and size as one mark', () => {
    const { doc } = parseOdtContent(
      styled('fo:color="#FF0000" fo:font-family="Georgia" fo:font-size="14pt"'),
    )

    const attrs = markOf(doc, 'textStyle')?.attrs
    expect(attrs?.['color']).toBe('#FF0000')
    expect(attrs?.['fontFamily']).toBe('Georgia')
    expect(attrs?.['fontSize']).toBe(14)
  })

  it('reads a background colour as a highlight', () => {
    const { doc } = parseOdtContent(styled('fo:background-color="#FFFF00"'))
    expect(markOf(doc, 'highlight')?.attrs?.['color']).toBe('#FFFF00')
  })

  it('treats a transparent background as no highlight', () => {
    const { doc } = parseOdtContent(styled('fo:background-color="transparent"'))
    expect(markOf(doc, 'highlight')).toBeUndefined()
  })

  it('leaves a size given as a percentage alone rather than guessing a number', () => {
    const { doc } = parseOdtContent(styled('fo:font-size="120%"'))
    expect(markOf(doc, 'textStyle')).toBeUndefined()
  })

  it('resolves a font named through the font declarations', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
<office:font-face-decls><style:font-face style:name="F1" svg:font-family="Courier New"/></office:font-face-decls>
<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties style:font-name="F1"/></style:style></office:automatic-styles>
<office:body><office:text><text:p><text:span text:style-name="T1">text</text:span></text:p></office:text></office:body>
</office:document-content>`

    const { doc } = parseOdtContent(xml)
    expect(markOf(doc, 'textStyle')?.attrs?.['fontFamily']).toBe('Courier New')
  })

  it('round-trips colour, highlight, family and size', () => {
    const source = parseOdtContent(
      styled('fo:color="#FF0000" fo:background-color="#FFFF00" fo:font-family="Georgia" fo:font-size="14pt"'),
    )
    const again = parseOdtContent(
      serializeOdtContent(source.doc, { contentAttributes: source.contentAttributes }),
    )

    const attrs = markOf(again.doc, 'textStyle')?.attrs
    expect(attrs?.['color']).toBe('#FF0000')
    expect(attrs?.['fontFamily']).toBe('Georgia')
    expect(attrs?.['fontSize']).toBe(14)
    expect(markOf(again.doc, 'highlight')?.attrs?.['color']).toBe('#FFFF00')
  })

  it('declares one style per combination, however many runs use it', () => {
    const xml = serializeOdtContent(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }] },
              { type: 'text', text: 'b', marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }] },
              { type: 'text', text: 'c', marks: [{ type: 'textStyle', attrs: { color: '#00FF00' } }] },
            ],
          },
        ],
      },
      { contentAttributes: {} },
    )

    expect(xml.match(/style:family="text"/gu)).toHaveLength(2)
  })
})

describe('odt paragraph alignment', () => {
  it('reads the alignment off the paragraph style', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:p text:style-name="P1">text</text:p>',
        '<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>',
      ),
    )

    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('center')
  })

  it('reads the edge ODF names as the side the editor names', () => {
    const { doc } = parseOdtContent(
      CONTENT(
        '<text:p text:style-name="P1">text</text:p>',
        '<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/></style:style>',
      ),
    )

    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('right')
  })

  it('writes an aligned paragraph as a style based on the plain one', () => {
    const xml = serializeOdtContent(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'x' }] },
        ],
      },
      { contentAttributes: {} },
    )

    expect(xml).toContain('style:parent-style-name="Standard"')
    expect(xml).toContain('fo:text-align="end"')
  })

  it('keeps a heading aligned without losing its level', () => {
    const source: ProseMirrorNodeJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [{ type: 'text', text: 'Title' }],
        },
      ],
    }

    const { doc } = parseOdtContent(serializeOdtContent(source, { contentAttributes: {} }))

    expect(doc.content?.[0]?.type).toBe('heading')
    expect(doc.content?.[0]?.attrs?.['level']).toBe(2)
    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('center')
  })

  it('leaves an unaligned paragraph pointing at the plain style', () => {
    const xml = serializeOdtContent(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
      { contentAttributes: {} },
    )

    expect(xml).toContain('text:style-name="Standard"')
    expect(xml).not.toContain('style:family="paragraph"')
  })
})
