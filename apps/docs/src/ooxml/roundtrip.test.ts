import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareXml, describeDifferences } from './compare'
import { DOCUMENT_PART, getPartText, readPackage, setPartText, writePackage } from './package'
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
    const pkg = await readPackage(await readFile(path))
    const original = getPartText(pkg, DOCUMENT_PART) ?? ''

    const rewritten = serializeParsed(parseDocument(original))
    const differences = compareXml(original, rewritten)

    expect(describeDifferences(differences)).toBe('no differences')
  })

  it.each(files)('$label keeps every other part byte-identical', async ({ path }) => {
    const pkg = await readPackage(await readFile(path))
    const parsed = parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')
    setPartText(pkg, DOCUMENT_PART, serializeParsed(parsed))

    const rewritten = await readPackage(await writePackage(pkg))

    for (const [partPath, part] of pkg.parts) {
      if (partPath === DOCUMENT_PART) continue
      expect(rewritten.parts.get(partPath)?.bytes, partPath).toStrictEqual(part.bytes)
    }
  })

  it.each(files)('$label parses without losing text', async ({ path }) => {
    const pkg = await readPackage(await readFile(path))
    const original = getPartText(pkg, DOCUMENT_PART) ?? ''
    const rewritten = serializeParsed(parseDocument(original))

    const textOf = (xml: string) =>
      [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map((match) => match[1]).join('')

    expect(textOf(rewritten)).toBe(textOf(original))
  })
})
