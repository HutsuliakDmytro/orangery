import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPartText, setPartText, writePackage } from '@orangery/ooxml-core'
import { main } from '../../packages/render-diff/src/index'
import { DOCUMENT_PART, readDocxPackage } from '../../apps/docs/src/ooxml/parts'
import { parseDocument } from '../../apps/docs/src/ooxml/parse-document'
import { serializeParsed } from '../../apps/docs/src/ooxml/serialize-document'
import {
  readDeck,
  readPptxPackage,
  rewriteEveryPart,
  saveDeck,
} from '../../packages/ooxml-presentation/src/index'
import { openWorkbook } from '../../apps/sheets/src/document/workbook'
import { workbookBytes } from '../../apps/sheets/src/document/save'

/**
 * The office corpus, rendered before and after a round-trip.
 *
 * The structural diff says what changed in the file; this says whether it
 * changed anything a person would see. They disagree in both directions — a
 * part can be rewritten into something identical to look at, and two files
 * that compare equal can render differently because the difference is in a
 * part nobody compared — which is why both run.
 *
 * Each app already has this for its own fixtures (`pnpm --filter docs
 * test:render`); what is here is the same harness pointed at the shared corpus,
 * where one format's files sit beside another's.
 *
 * Needs `soffice` and `pdftoppm`. One format at a time, because LibreOffice
 * converts a `.docx` and a `.pptx` by different routes and the slow one should
 * not hold up the other.
 *
 * Usage: pnpm corpus:render [--format docx|pptx|xlsx] [--corpus <dir>] [--threshold 0.001]
 */

function argumentValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const format = argumentValue('--format', 'docx')
const corpus = argumentValue('--corpus', join(process.cwd(), 'tests/fixtures/office'))

/** Open and save, the same way the corpus round-trip run does it. */
async function roundTrip(input: string, output: string): Promise<void> {
  const bytes = new Uint8Array(await readFile(input))

  if (format === 'docx') {
    const pkg = await readDocxPackage(bytes)
    const text = getPartText(pkg, DOCUMENT_PART) ?? ''
    setPartText(pkg, DOCUMENT_PART, serializeParsed(parseDocument(text), text))
    await writeFile(output, await writePackage(pkg))
    return
  }

  if (format === 'pptx') {
    const pkg = await readPptxPackage(bytes)
    rewriteEveryPart(pkg, readDeck(pkg))
    await writeFile(output, await saveDeck(pkg))
    return
  }

  const open = await openWorkbook(bytes)
  await writeFile(output, await workbookBytes(open, { edited: true }))
}

await main({
  corpus,
  groups: [format],
  extension: `.${format}`,
  output: join(process.cwd(), `test-results/corpus-render/${format}`),
  roundTrip,
  argv: process.argv.slice(2),
})
