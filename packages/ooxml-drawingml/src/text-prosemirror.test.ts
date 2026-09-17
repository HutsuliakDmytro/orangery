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
