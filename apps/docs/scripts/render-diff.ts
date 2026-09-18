/**
 * The visual round-trip check for documents.
 *
 * The harness — rendering, rasterising, comparing — is shared with Slides; what
 * belongs here is only what a round-trip means for a `.docx`: parse the one
 * part we model and serialise it back, which is the step that would lose
 * anything it is going to lose.
 *
 * Usage: pnpm test:render [--threshold 0.001] [--keep]
 */

import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPartText, setPartText, writePackage } from '@orangery/ooxml-core'
import { main } from '@orangery/render-diff'
import { DOCUMENT_PART, readDocxPackage } from '../src/ooxml/parts'
import { parseDocument } from '../src/ooxml/parse-document'
import { serializeParsed } from '../src/ooxml/serialize-document'

async function roundTrip(inputPath: string, outputPath: string): Promise<void> {
  const pkg = await readDocxPackage(await readFile(inputPath))
  const parsed = parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')
  setPartText(pkg, DOCUMENT_PART, serializeParsed(parsed))
  await writeFile(outputPath, await writePackage(pkg))
}

await main({
  corpus: join(process.cwd(), 'tests/fixtures/docx'),
  extension: '.docx',
  output: join(process.cwd(), 'test-results/render-diff'),
  roundTrip,
  argv: process.argv.slice(2),
})
