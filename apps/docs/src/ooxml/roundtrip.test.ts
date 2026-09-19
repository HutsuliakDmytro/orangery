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
import { serializeParsed } from './serialize-document'

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

    const rewritten = serializeParsed(parseDocument(original))
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
