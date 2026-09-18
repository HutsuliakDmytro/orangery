/**
 * The visual round-trip check for decks.
 *
 * Every part holding a shape tree is forced through parse and serialise rather
 * than saved as it was. An ordinary save of an unedited deck is byte for byte
 * the file it opened, so rendering it twice would prove nothing; regenerating
 * every part is the step that could change how a slide looks, and this is the
 * check that it does not.
 *
 * Usage: pnpm test:render [--threshold 0.001] [--keep]
 */

import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readDeck, readPptxPackage, rewriteEveryPart, saveDeck } from '@orangery/ooxml-presentation'
import { main } from '@orangery/render-diff'

async function roundTrip(inputPath: string, outputPath: string): Promise<void> {
  const pkg = await readPptxPackage(await readFile(inputPath))
  rewriteEveryPart(pkg, readDeck(pkg))
  await writeFile(outputPath, await saveDeck(pkg))
}

await main({
  corpus: join(process.cwd(), 'tests/fixtures/pptx'),
  extension: '.pptx',
  output: join(process.cwd(), 'test-results/render-diff'),
  roundTrip,
  argv: process.argv.slice(2),
})
