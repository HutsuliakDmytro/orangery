import {
  compareXml,
  describeDifferences,
  describeProblems,
  getPartText,
  problemsIn,
  setPartText,
  writePackage,
} from '@orangery/ooxml-core'
import { addImage } from '../document/media'
import { DOCUMENT_PART, readDocxPackage } from './parts'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeDocument, serializeParsed } from './serialize-document'

const CORPUS_ROOT = join(process.cwd(), 'tests/fixtures/docx')

async function corpusFiles(): Promise<{ label: string; path: string }[]> {
  const files: { label: string; path: string }[] = []

  for (const group of ['synthetic', 'real']) {
    const directory = join(CORPUS_ROOT, group)
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith('.docx') || entry.startsWith('~$')) continue
      files.push({ label: `${group}/${entry}`, path: join(directory, entry) })
    }
  }

  return files
}

const files = await corpusFiles()

describe('document.xml round-trip', () => {
  it('has a corpus to test against', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('$label survives open → save unchanged', async ({ path }) => {
    const pkg = await readDocxPackage(await readFile(path))
    const original = getPartText(pkg, DOCUMENT_PART) ?? ''

    const rewritten = serializeParsed(parseDocument(original), original)
    const differences = compareXml(original, rewritten)

    expect(describeDifferences(differences)).toBe('no differences')
  })

  it.each(files)('$label keeps every other part byte-identical', async ({ path }) => {
    const pkg = await readDocxPackage(await readFile(path))
    const parsed = parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')
    setPartText(pkg, DOCUMENT_PART, serializeParsed(parsed))

    const rewritten = await readDocxPackage(await writePackage(pkg))

    for (const [partPath, part] of pkg.parts) {
      if (partPath === DOCUMENT_PART) continue
      expect(rewritten.parts.get(partPath)?.bytes, partPath).toStrictEqual(part.bytes)
    }
  })

  it.each(files)('$label parses without losing text', async ({ path }) => {
    const pkg = await readDocxPackage(await readFile(path))
    const original = getPartText(pkg, DOCUMENT_PART) ?? ''
    const rewritten = serializeParsed(parseDocument(original))

    const textOf = (xml: string) =>
      [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map((match) => match[1]).join('')

    expect(textOf(rewritten)).toBe(textOf(original))
  })
})

/**
 * A document that is still a package after being edited.
 *
 * The round-trip above asks whether the text comes back; this asks whether the
 * file does. The readers here are lenient — they look for an element by name —
 * so a part written with two XML declarations or a relationship pointing at a
 * part nobody wrote reads back perfectly and is a document Word offers to
 * repair, and nothing else in this app would notice.
 */
describe('the package itself', () => {
  it.each(files)('$label opens sound', async ({ path }) => {
    const pkg = await readDocxPackage(await readFile(path))
    expect(describeProblems(problemsIn(pkg))).toBe('')
  })

  it.each(files)('$label is still sound after an image and a rewrite', async ({ path }) => {
    const pkg = await readDocxPackage(await readFile(path))

    // The one edit that touches three things at once: the bytes, the content
    // types and the relationship that names them.
    addImage(pkg, 'pixel.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    setPartText(
      pkg,
      DOCUMENT_PART,
      serializeParsed(parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')),
    )

    const saved = await readDocxPackage(await writePackage(pkg))
    expect(describeProblems(problemsIn(saved))).toBe('')
  })
})

/**
 * The root of `word/document.xml`, and what hangs off it beside the body.
 *
 * `w:background` is a page colour or a watermark's fill, and the only child
 * ECMA-376 lets the root have other than `w:body`. A serialiser that writes a
 * document as a root with a body in it drops it — 34 documents in the full
 * corpus — and the declaration a part was written with was being replaced with
 * ours in every regenerated part.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/16
 */
describe('what surrounds the body', () => {
  const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const document =
    `<?xml version='1.0' encoding='utf-8'?>\n` +
    `<w:document xmlns:w="${WORD}" xmlns:v="urn:schemas-microsoft-com:vml">` +
    `<w:background w:color="FFE599"><v:background id="_x0000_s1025"/></w:background>` +
    `<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`

  it('keeps w:background, with what is inside it', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(rewritten).toContain('<w:background w:color="FFE599">')
    expect(rewritten).toContain('<v:background id="_x0000_s1025"/>')
  })

  it('keeps it in front of the body, where the schema puts it', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(rewritten.indexOf('w:background')).toBeLessThan(rewritten.indexOf('<w:body>'))
  })

  it('keeps the declaration the document was written with', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(rewritten.startsWith(`<?xml version='1.0' encoding='utf-8'?>\n`)).toBe(true)
  })

  it('reports no differences at all for such a document', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(describeDifferences(compareXml(document, rewritten))).toBe('no differences')
  })

  it('writes our own declaration when there was no part to keep one from', () => {
    const rewritten = serializeParsed(parseDocument(document))

    expect(rewritten.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(
      true,
    )
  })
})

/**
 * `xml:space`, which is a fact about a run rather than about a document.
 *
 * Word writes it where the space would otherwise be dropped, Google Docs on
 * every run, LibreOffice on some runs and not others. It used to be one flag
 * for the whole file — "every run had it" — so the mixed convention lost the
 * attribute from the runs that did not need it, and a conforming reader is
 * then free to drop a space somebody typed. Fifteen files in the full corpus.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/16
 */
describe('a document that states xml:space on some runs and not others', () => {
  const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:document xmlns:w="${WORD}"><w:body><w:p>` +
    `<w:r><w:t xml:space="preserve">kept</w:t></w:r>` +
    `<w:r><w:t>plain</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> spaced </w:t></w:r>` +
    `</w:p></w:body></w:document>`

  it('keeps it on the run that had it', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(rewritten).toContain('<w:t xml:space="preserve">kept</w:t>')
  })

  it('does not put it on the run that did not', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(rewritten).toContain('<w:t>plain</w:t>')
  })

  it('leaves the document with no differences at all', () => {
    const rewritten = serializeParsed(parseDocument(document), document)

    expect(describeDifferences(compareXml(document, rewritten))).toBe('no differences')
  })

  it('writes it on a run that did not state it but would lose a space', () => {
    // The model's silence must not outrank the text in front of it: a run read
    // without the attribute, whose text has an edge space, still gets it.
    const source =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
      `<w:document xmlns:w="${WORD}"><w:body><w:p>` +
      `<w:r><w:t> edged </w:t></w:r>` +
      `</w:p></w:body></w:document>`

    expect(serializeParsed(parseDocument(source), source)).toContain(
      '<w:t xml:space="preserve"> edged </w:t>',
    )
  })

  it('still writes it where text would lose a space without it', () => {
    // Text that never came from a file — typed, or pasted — has no run to
    // follow, and the rule is the serialiser's own.
    const typed = serializeDocument(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: ' leading' }] }],
      },
      { documentAttributes: {}, sectionProperties: null },
    )

    expect(typed).toContain('<w:t xml:space="preserve"> leading</w:t>')
  })
})
