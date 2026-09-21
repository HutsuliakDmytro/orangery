/**
 * What a deck does to this program, one step at a time.
 *
 * For the report that begins "it went black". A render that throws takes the
 * whole window with it and says nothing, so the question is which step threw —
 * and the steps a deck goes through before a pixel is drawn are all pure
 * functions that can be run here, outside a window, over somebody's own file.
 *
 * It reads nothing but the file it is given and prints nothing but what it
 * finds. Nobody has to send a deck anywhere to use it.
 *
 * Usage: pnpm --filter slides exec vite-node scripts/diagnose.ts -- <deck.pptx>
 */

import { readFile } from 'node:fs/promises'
import { readChart } from '@orangery/charts'
import { getPartText } from '@orangery/ooxml-core'
import {
  readDeck,
  readPptxPackage,
  readThemes,
  relationshipTarget,
} from '@orangery/ooxml-presentation'

const path = process.argv[2]

if (path === undefined) {
  console.error('Usage: vite-node scripts/diagnose.ts -- <deck.pptx>')
  process.exit(1)
}

/** A step that either says how it went or says what it threw, and carries on. */
function step<T>(what: string, run: () => T): T | null {
  try {
    const value = run()
    console.log(`  ok    ${what}`)
    return value
  } catch (error) {
    console.log(`  THREW ${what}`)
    console.log(`        ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.stack !== undefined) {
      console.log(
        error.stack
          .split('\n')
          .slice(1, 5)
          .map((line) => `        ${line.trim()}`)
          .join('\n'),
      )
    }
    return null
  }
}

console.log(`\n${path}\n`)

const bytes = new Uint8Array(await readFile(path))
const pkg = await readPptxPackage(bytes)

console.log('the package')
console.log(`  ok    ${String(pkg.parts.size)} parts`)

console.log('\nthe deck')
const deck = step('readDeck', () => readDeck(pkg))
if (deck === null) process.exit(1)

step('readThemes', () => readThemes(pkg, deck))
console.log(`  ok    ${String(deck.slides.length)} slides`)

/**
 * Every chart, read the way the window reads it.
 *
 * First because it is the newest thing in this app and the likeliest to be
 * the one that threw: the chart engine arrived after every fixture in this
 * repository was written, and no synthetic deck has a chart PowerPoint made.
 */
console.log('\nthe charts')
let charts = 0

for (const [index, slide] of deck.slides.entries()) {
  const frames = slide.shapes.filter((shape) => shape.graphic?.relationshipId !== undefined)

  for (const frame of frames) {
    charts += 1
    const target = relationshipTarget(pkg, slide.path, frame.graphic?.relationshipId ?? '')
    const xml = target === null ? undefined : getPartText(pkg, target)

    if (xml === undefined) {
      console.log(`  ..    slide ${String(index + 1)}: a graphic that is not a part we hold`)
      continue
    }

    step(`slide ${String(index + 1)}: readChart ${target ?? ''}`, () => readChart(xml))
  }
}

if (charts === 0) console.log('  ..    none, so the chart engine is not what threw')

console.log('\nEverything above that says ok is not the problem.')
console.log('If nothing threw, the failure is in drawing rather than in reading,')
console.log('and the window will now name it rather than going black.\n')
