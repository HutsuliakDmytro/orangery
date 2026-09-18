import { describe, expect, it } from 'vitest'
import { parseXml, serializeNode } from '@orangery/ooxml-core'
import { readTextBody } from './text-body'
import { textBodyToDoc, writeTextBody } from './text-prosemirror'
import type { PmMark, PmNode } from './text-prosemirror'

/**
 * What a run says about its characters, across the bridge and back.
 *
 * The file is what is checked: a mark that does not reach `a:rPr` has not
 * happened, and an attribute the editor cleared that comes back is worse.
 */

const body = (runProperties: string) => {
  const xml = `<p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:bodyPr/><a:p><a:r>${runProperties}<a:t>Words</a:t></a:r></a:p></p:txBody>`

  const node = parseXml(xml)[0]
  if (node === undefined) throw new Error('bad fixture')

  return { node, body: readTextBody(node) }
}

const marksOfFirstRun = (doc: PmNode): PmMark[] => doc.content?.[0]?.content?.[0]?.marks ?? []

const styleOfFirstRun = (doc: PmNode): Record<string, unknown> =>
  marksOfFirstRun(doc).find((mark) => mark.type === 'textStyle')?.attrs ?? {}

/** Reads a body, hands the doc back after `change`, and returns the new XML. */
function roundTrip(runProperties: string, change: (doc: PmNode) => PmNode): string {
  const { node, body: read } = body(runProperties)
  writeTextBody(read.node, change(textBodyToDoc(read)))
  return serializeNode(node)
}

/** Replaces the marks on the only run in the document. */
const withMarks = (marks: PmMark[]) => (doc: PmNode) => {
  const paragraph = doc.content?.[0]
  const run = paragraph?.content?.[0]
  if (paragraph === undefined || run === undefined) throw new Error('bad doc')

  const preserved = (run.marks ?? []).filter((mark) => mark.type === 'preservedRunProperties')
  return {
    ...doc,
    content: [{ ...paragraph, content: [{ ...run, marks: [...preserved, ...marks] }] }],
  }
}

describe('reading a run', () => {
  it('sees a strikethrough', () => {
    const { body: read } = body('<a:rPr strike="sngStrike"/>')
    expect(marksOfFirstRun(textBodyToDoc(read)).map((mark) => mark.type)).toContain('strike')
  })

  it('tells a raise from a drop by the sign', () => {
    const up = body('<a:rPr baseline="30000"/>').body
    const down = body('<a:rPr baseline="-25000"/>').body

    expect(marksOfFirstRun(textBodyToDoc(up)).map((m) => m.type)).toContain('superscript')
    expect(marksOfFirstRun(textBodyToDoc(down)).map((m) => m.type)).toContain('subscript')
  })

  it('reads capitals and letter spacing', () => {
    const { body: read } = body('<a:rPr cap="small" spc="150"/>')
    const style = styleOfFirstRun(textBodyToDoc(read))

    expect(style['caps']).toBe('small')
    // Hundredths of a point, like every other run measurement.
    expect(style['letterSpacing']).toBe(1.5)
  })

  it('reads a literal colour and a highlight', () => {
    const { body: read } = body(
      '<a:rPr><a:solidFill><a:srgbClr val="ff7a00"/></a:solidFill>' +
        '<a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr>',
    )
    const style = styleOfFirstRun(textBodyToDoc(read))

    expect(style['color']).toBe('#FF7A00')
    expect(style['highlight']).toBe('#FFFF00')
  })

  it('leaves a theme colour out of the mark, so it stays a slot', () => {
    const { body: read } = body(
      '<a:rPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>',
    )
    expect(styleOfFirstRun(textBodyToDoc(read))['color']).toBeUndefined()
  })

  it('leaves a colour carrying transforms out of the mark', () => {
    // Dropping the alpha would be a change nobody asked for.
    const { body: read } = body(
      '<a:rPr><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:rPr>',
    )
    expect(styleOfFirstRun(textBodyToDoc(read))['color']).toBeUndefined()
  })
})

describe('writing a run', () => {
  it('writes a strikethrough and takes it away again', () => {
    expect(roundTrip('<a:rPr/>', withMarks([{ type: 'strike' }]))).toContain('strike="sngStrike"')
    expect(roundTrip('<a:rPr strike="sngStrike"/>', withMarks([]))).not.toContain('strike=')
  })

  it('writes the percentages PowerPoint writes for a raise and a drop', () => {
    expect(roundTrip('<a:rPr/>', withMarks([{ type: 'superscript' }]))).toContain(
      'baseline="30000"',
    )
    expect(roundTrip('<a:rPr/>', withMarks([{ type: 'subscript' }]))).toContain('baseline="-25000"')
  })

  it('clears a baseline the run no longer has', () => {
    expect(roundTrip('<a:rPr baseline="30000"/>', withMarks([]))).not.toContain('baseline')
  })

  it('writes capitals and letter spacing', () => {
    const xml = roundTrip(
      '<a:rPr/>',
      withMarks([{ type: 'textStyle', attrs: { caps: 'all', letterSpacing: 2 } }]),
    )

    expect(xml).toContain('cap="all"')
    expect(xml).toContain('spc="200"')
  })

  it('clears capitals when the editor says the run has none', () => {
    // Null is the editor stating there is none; restoring it from the preserved
    // properties would be the edit that silently did not happen.
    const xml = roundTrip(
      '<a:rPr cap="all" spc="200"/>',
      withMarks([{ type: 'textStyle', attrs: { caps: null, letterSpacing: null } }]),
    )

    expect(xml).not.toContain('cap=')
    expect(xml).not.toContain('spc=')
  })

  it('leaves them alone for an editor that does not model them', () => {
    // Undefined is not null: the file's own answer stands.
    const xml = roundTrip(
      '<a:rPr cap="all"/>',
      withMarks([{ type: 'textStyle', attrs: { fontSize: 18 } }]),
    )
    expect(xml).toContain('cap="all"')
  })

  it('writes a colour and a highlight', () => {
    const xml = roundTrip(
      '<a:rPr/>',
      withMarks([{ type: 'textStyle', attrs: { color: '#FF7A00', highlight: '#FFFF00' } }]),
    )

    expect(xml).toContain('<a:solidFill><a:srgbClr val="FF7A00"/></a:solidFill>')
    expect(xml).toContain('<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>')
  })

  it('clears a literal colour the editor cleared', () => {
    const xml = roundTrip(
      '<a:rPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr>',
      withMarks([{ type: 'textStyle', attrs: { color: null } }]),
    )
    expect(xml).not.toContain('solidFill')
  })

  it('will not clear a theme colour it never carried', () => {
    // The mark says null because the slot never reached it, not because
    // anybody asked for the colour to go.
    const xml = roundTrip(
      '<a:rPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>',
      withMarks([{ type: 'textStyle', attrs: { color: null } }]),
    )
    expect(xml).toContain('accent1')
  })

  it('replaces a theme colour when a colour is actually picked', () => {
    const xml = roundTrip(
      '<a:rPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>',
      withMarks([{ type: 'textStyle', attrs: { color: '#FF7A00' } }]),
    )

    expect(xml).not.toContain('accent1')
    expect(xml).toContain('FF7A00')
  })

  it('keeps everything it does not model', () => {
    const xml = roundTrip('<a:rPr lang="uk-UA" dirty="0"/>', withMarks([{ type: 'bold' }]))

    expect(xml).toContain('lang="uk-UA"')
    expect(xml).toContain('dirty="0"')
    expect(xml).toContain('b="1"')
  })
})
