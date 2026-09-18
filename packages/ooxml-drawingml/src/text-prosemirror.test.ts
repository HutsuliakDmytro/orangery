import { parseXml, serializeNode } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { readTextBody } from './text-body'
import { textBodyToDoc, writeTextBody } from './text-prosemirror'
import type { PmNode } from './text-prosemirror'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

const body = (inner: string) => node(`<p:txBody>${inner}</p:txBody>`)
const docOf = (inner: string) => textBodyToDoc(readTextBody(body(inner)))

const marksOn = (doc: PmNode, index = 0) =>
  (doc.content?.[0]?.content?.[index]?.marks ?? []).map((mark) => mark.type)

describe('reading text as a document', () => {
  it('turns runs into text with marks', () => {
    const doc = docOf(
      '<a:p><a:r><a:rPr b="1" sz="2400"/><a:t>bold</a:t></a:r>' +
        '<a:r><a:rPr i="1"/><a:t>italic</a:t></a:r></a:p>',
    )

    expect(doc.content?.[0]?.content?.map((run) => run.text)).toEqual(['bold', 'italic'])
    expect(marksOn(doc)).toContain('bold')
    expect(marksOn(doc)).toContain('textStyle')
    expect(marksOn(doc, 1)).toContain('italic')
  })

  it('gives each run its own properties, even when they read the same', () => {
    // Matching runs by their text would hand both the first one's formatting.
    const doc = docOf(
      '<a:p><a:r><a:rPr b="1"/><a:t>same</a:t></a:r>' +
        '<a:r><a:rPr i="1"/><a:t>same</a:t></a:r></a:p>',
    )

    expect(marksOn(doc, 0)).toContain('bold')
    expect(marksOn(doc, 1)).toContain('italic')
    expect(marksOn(doc, 1)).not.toContain('bold')
  })

  it('carries what the marks do not describe', () => {
    const doc = docOf(
      '<a:p><a:r><a:rPr lang="uk-UA" dirty="0"><a:highlight><a:srgbClr val="FFFF00"/>' +
        '</a:highlight></a:rPr><a:t>x</a:t></a:r></a:p>',
    )
    const preserved = doc.content?.[0]?.content?.[0]?.marks?.find(
      (mark) => mark.type === 'preservedRunProperties',
    )

    expect(String(preserved?.attrs?.['xml'])).toContain('a:highlight')
    expect(String(preserved?.attrs?.['xml'])).toContain('uk-UA')
  })

  it('keeps a line break as its own node', () => {
    const doc = docOf('<a:p><a:r><a:t>one</a:t></a:r><a:br/><a:r><a:t>two</a:t></a:r></a:p>')
    expect(doc.content?.[0]?.content?.map((one) => one.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('keeps the outline level and the alignment', () => {
    const doc = docOf('<a:p><a:pPr lvl="2" algn="ctr"/><a:r><a:t>x</a:t></a:r></a:p>')
    expect(doc.content?.[0]?.attrs).toMatchObject({ level: 2, align: 'ctr' })
  })
})

describe('writing a document back', () => {
  const roundTrip = (inner: string) => {
    const element = body(inner)
    const before = serializeNode(element)
    writeTextBody(element, textBodyToDoc(readTextBody(element)))
    return { before, after: serializeNode(element) }
  }

  it('leaves an untouched body exactly as it was', () => {
    // The harshest thing this can be asked: read, convert, convert back, and
    // produce the same bytes, including the markup nothing here reads.
    const { before, after } = roundTrip(
      '<a:bodyPr anchor="ctr"/><a:lstStyle/>' +
        '<a:p><a:pPr lvl="1" algn="l"/><a:r><a:rPr lang="uk-UA" b="1" dirty="0">' +
        '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>text</a:t></a:r>' +
        '<a:endParaRPr lang="uk-UA"/></a:p>',
    )

    expect(after).toBe(before)
  })

  it('keeps an empty paragraph and what it carries', () => {
    const { before, after } = roundTrip(
      '<a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr sz="2400" b="1"/></a:p>',
    )
    expect(after).toBe(before)
  })

  it('leaves the body properties and the list style alone', () => {
    const element = body(
      '<a:bodyPr anchor="b" wrap="none"/><a:lstStyle><a:lvl1pPr marL="100"/></a:lstStyle><a:p/>',
    )
    writeTextBody(element, { type: 'doc', content: [] })

    const after = serializeNode(element)
    expect(after).toContain('anchor="b"')
    expect(after).toContain('marL="100"')
  })

  it('patches the properties of a run whose formatting changed', () => {
    // The run keeps its language and its highlight; only the weight differs.
    const element = body(
      '<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="uk-UA"><a:highlight>' +
        '<a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>x</a:t></a:r></a:p>',
    )
    const doc = textBodyToDoc(readTextBody(element))
    const run = doc.content?.[0]?.content?.[0]
    if (run !== undefined) run.marks = [...(run.marks ?? []), { type: 'bold' }]

    writeTextBody(element, doc)
    const after = serializeNode(element)

    expect(after).toContain('b="1"')
    expect(after).toContain('uk-UA')
    expect(after).toContain('a:highlight')
  })

  it('removes a property that was turned off', () => {
    const element = body('<a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>x</a:t></a:r></a:p>')
    const doc = textBodyToDoc(readTextBody(element))
    const run = doc.content?.[0]?.content?.[0]
    if (run !== undefined) run.marks = (run.marks ?? []).filter((mark) => mark.type !== 'bold')

    writeTextBody(element, doc)
    expect(serializeNode(element)).not.toContain('b="1"')
  })

  it('writes text that was never in the file', () => {
    const element = body('<a:bodyPr/><a:lstStyle/><a:p/>')
    writeTextBody(element, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'typed' }] }],
    })

    expect(serializeNode(element)).toContain('<a:t>typed</a:t>')
  })
})

describe('what the editor owns', () => {
  it('writes a level that was changed', () => {
    // Read, edited and silently not saved is the failure this guards: the file
    // is the only place the answer counts.
    const element = body('<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>x</a:t></a:r></a:p>')
    const doc = textBodyToDoc(readTextBody(element))
    const paragraph = doc.content?.[0]
    if (paragraph !== undefined) paragraph.attrs = { ...paragraph.attrs, level: 3 }

    writeTextBody(element, doc)
    expect(serializeNode(element)).toContain('lvl="3"')
  })

  it('removes the level when it goes back to the outermost', () => {
    const element = body(
      '<a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="2"/><a:r><a:t>x</a:t></a:r></a:p>',
    )
    const doc = textBodyToDoc(readTextBody(element))
    const paragraph = doc.content?.[0]
    if (paragraph !== undefined) paragraph.attrs = { ...paragraph.attrs, level: 0 }

    writeTextBody(element, doc)
    expect(serializeNode(element)).not.toContain('lvl=')
  })

  it('writes an alignment onto a paragraph that had no properties at all', () => {
    const element = body('<a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>x</a:t></a:r></a:p>')
    const doc = textBodyToDoc(readTextBody(element))
    const paragraph = doc.content?.[0]
    if (paragraph !== undefined) paragraph.attrs = { ...paragraph.attrs, align: 'ctr' }

    writeTextBody(element, doc)
    const after = serializeNode(element)

    expect(after).toContain('algn="ctr"')
    // First child of the paragraph, where the schema puts it.
    expect(after.indexOf('<a:pPr')).toBeLessThan(after.indexOf('<a:r>'))
  })

  it('keeps the rest of the properties while changing one', () => {
    const element = body(
      '<a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="1" marL="342900"><a:buChar char="•"/></a:pPr>' +
        '<a:r><a:t>x</a:t></a:r></a:p>',
    )
    const doc = textBodyToDoc(readTextBody(element))
    const paragraph = doc.content?.[0]
    if (paragraph !== undefined) paragraph.attrs = { ...paragraph.attrs, level: 2 }

    writeTextBody(element, doc)
    const after = serializeNode(element)

    expect(after).toContain('lvl="2"')
    expect(after).toContain('marL="342900"')
    expect(after).toContain('a:buChar')
  })
})

describe('bullets', () => {
  const withBullet = (inner: string, bullet: unknown) => {
    const element = body(`<a:bodyPr/><a:lstStyle/>${inner}`)
    const doc = textBodyToDoc(readTextBody(element))
    const paragraph = doc.content?.[0]
    if (paragraph !== undefined) paragraph.attrs = { ...paragraph.attrs, bullet }

    writeTextBody(element, doc)
    return serializeNode(element)
  }

  it('reads which kind a paragraph states', () => {
    const doc = docOf('<a:p><a:pPr><a:buChar char="•"/></a:pPr></a:p>')
    expect(doc.content?.[0]?.attrs?.['bullet']).toBe('character')
  })

  it('reads nothing stated as null, which is not the same as none', () => {
    expect(docOf('<a:p><a:pPr/></a:p>').content?.[0]?.attrs?.['bullet']).toBeNull()
    expect(docOf('<a:p><a:pPr><a:buNone/></a:pPr></a:p>').content?.[0]?.attrs?.['bullet']).toBe(
      'none',
    )
  })

  it('writes a character bullet with a font that has the glyph', () => {
    const after = withBullet('<a:p><a:r><a:t>x</a:t></a:r></a:p>', 'character')

    expect(after).toContain('a:buChar')
    expect(after).toContain('typeface="Arial"')
  })

  it('writes a numbered bullet', () => {
    expect(withBullet('<a:p><a:r><a:t>x</a:t></a:r></a:p>', 'number')).toContain('a:buAutoNum')
  })

  it('replaces one kind with another rather than keeping both', () => {
    const after = withBullet('<a:p><a:pPr><a:buChar char="•"/></a:pPr></a:p>', 'number')

    expect(after).toContain('a:buAutoNum')
    expect(after).not.toContain('a:buChar')
  })

  it("goes back to the level's bullet when told to inherit", () => {
    // Which is a different answer from "none": the level has one, and the
    // paragraph stops disagreeing with it.
    const after = withBullet('<a:p><a:pPr><a:buNone/></a:pPr></a:p>', 'inherit')

    expect(after).not.toContain('a:buNone')
    expect(after).not.toContain('a:buChar')
  })

  it('puts the bullet where the schema wants it', () => {
    const after = withBullet(
      '<a:p><a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr><a:r><a:t>x</a:t></a:r></a:p>',
      'character',
    )

    expect(after.indexOf('a:spcBef')).toBeLessThan(after.indexOf('a:buFont'))
    expect(after.indexOf('a:buFont')).toBeLessThan(after.indexOf('a:buChar'))
  })

  it('leaves a paragraph alone when nothing asked for a bullet', () => {
    const { before, after } = (() => {
      const element = body('<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:buChar char="•"/></a:pPr></a:p>')
      const text = serializeNode(element)
      writeTextBody(element, textBodyToDoc(readTextBody(element)))
      return { before: text, after: serializeNode(element) }
    })()

    expect(after).toBe(before)
  })
})

describe('line spacing', () => {
  const withSpacing = (inner: string, lineSpacing: unknown) => {
    const element = body(`<a:bodyPr/><a:lstStyle/>${inner}`)
    const doc = textBodyToDoc(readTextBody(element))
    const paragraph = doc.content?.[0]
    if (paragraph !== undefined) paragraph.attrs = { ...paragraph.attrs, lineSpacing }

    writeTextBody(element, doc)
    return serializeNode(element)
  }

  it('reads a percentage as a multiple', () => {
    const doc = docOf('<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr></a:p>')
    expect(doc.content?.[0]?.attrs?.['lineSpacing']).toBe(1.5)
  })

  it('writes one that was set', () => {
    expect(withSpacing('<a:p><a:r><a:t>x</a:t></a:r></a:p>', 2)).toContain('val="200000"')
  })

  it('removes one that was cleared', () => {
    const after = withSpacing(
      '<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr></a:p>',
      null,
    )
    expect(after).not.toContain('a:lnSpc')
  })

  it('leaves an absolute spacing alone, since it cannot be read as a multiple', () => {
    // Removing it would lose an exact 18pt the first time anything else about
    // the paragraph was edited.
    const after = withSpacing(
      '<a:p><a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr><a:r><a:t>x</a:t></a:r></a:p>',
      null,
    )

    expect(after).toContain('a:spcPts')
    expect(after).toContain('val="1800"')
  })

  it('changes nothing on a paragraph nobody touched', () => {
    const element = body(
      '<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr></a:p>',
    )
    const before = serializeNode(element)
    writeTextBody(element, textBodyToDoc(readTextBody(element)))

    expect(serializeNode(element)).toBe(before)
  })
})

describe('paragraph indents', () => {
  it('reads how far a paragraph is pushed in', () => {
    const body = readTextBody(
      node(
        '<a:txBody><a:bodyPr/><a:p><a:pPr marL="457200" indent="-228600"/><a:r><a:t>In</a:t></a:r></a:p></a:txBody>',
      ),
    )

    const paragraph = textBodyToDoc(body).content?.[0]
    expect(paragraph?.attrs?.['marginLeft']).toBe(457200)
    expect(paragraph?.attrs?.['firstLine']).toBe(-228600)
  })

  it('says nothing about a paragraph that says nothing', () => {
    const body = readTextBody(
      node('<a:txBody><a:bodyPr/><a:p><a:r><a:t>Plain</a:t></a:r></a:p></a:txBody>'),
    )
    const paragraph = textBodyToDoc(body).content?.[0]

    // Null and zero are different answers: one inherits, the other decides.
    expect(paragraph?.attrs?.['marginLeft']).toBeNull()
  })

  it('writes an indent back', () => {
    const target = node('<a:txBody><a:bodyPr/><a:p><a:r><a:t>Move me</a:t></a:r></a:p></a:txBody>')
    const doc = textBodyToDoc(readTextBody(target))
    const first = doc.content?.[0]
    if (first === undefined) throw new Error('no paragraph')

    writeTextBody(target, {
      ...doc,
      content: [{ ...first, attrs: { ...first.attrs, marginLeft: 228600 } }],
    })

    expect(serializeNode(target)).toContain('marL="228600"')
  })

  it('takes it away again rather than writing a zero', () => {
    const target = node(
      '<a:txBody><a:bodyPr/><a:p><a:pPr marL="228600"/><a:r><a:t>Back</a:t></a:r></a:p></a:txBody>',
    )
    const doc = textBodyToDoc(readTextBody(target))
    const first = doc.content?.[0]
    if (first === undefined) throw new Error('no paragraph')

    writeTextBody(target, {
      ...doc,
      content: [{ ...first, attrs: { ...first.attrs, marginLeft: null } }],
    })

    // A paragraph indented and then un-indented is the paragraph it was.
    expect(serializeNode(target)).not.toContain('marL')
  })

  it('leaves the rest of the properties alone', () => {
    const target = node(
      '<a:txBody><a:bodyPr/><a:p><a:pPr lvl="2"><a:buChar char="—"/></a:pPr><a:r><a:t>Deep</a:t></a:r></a:p></a:txBody>',
    )
    const doc = textBodyToDoc(readTextBody(target))
    const first = doc.content?.[0]
    if (first === undefined) throw new Error('no paragraph')

    writeTextBody(target, {
      ...doc,
      content: [{ ...first, attrs: { ...first.attrs, marginLeft: 457200 } }],
    })

    const written = serializeNode(target)
    expect(written).toContain('marL="457200"')
    expect(written).toContain('lvl="2"')
    expect(written).toContain('buChar')
  })
})
