import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extname } from 'node:path'
import { Entry, formatBytes, inspect, isDocument, mapLimit, RAW_ROOT, walk } from './lib'

/**
 * What is in the raw corpus.
 *
 * Reads every file under `~/corpus-raw` — or wherever `ORANGERY_CORPUS_RAW`
 * points — and writes down what it is: format, generator, the parts of the
 * package, and which of the features the selection matrix asks about it
 * happens to have. Nothing is opened by the app here and nothing is judged;
 * this only answers "what do we have", which every later step needs and none
 * of them should have to work out again.
 *
 * Usage: pnpm corpus:inventory [--out corpus-inventory.json]
 */

function argumentValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

function tally(entries: readonly Entry[], key: (entry: Entry) => string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const value of key(entry)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function table(title: string, rows: readonly [string, number][], limit = 40): void {
  console.log(`\n${title}`)
  if (rows.length === 0) {
    console.log('  (none)')
    return
  }
  const width = Math.max(...rows.slice(0, limit).map(([name]) => name.length))
  for (const [name, count] of rows.slice(0, limit)) {
    console.log(`  ${name.padEnd(width)}  ${String(count).padStart(5)}`)
  }
  if (rows.length > limit) console.log(`  … and ${String(rows.length - limit)} more`)
}

const out = argumentValue('--out', join(process.cwd(), 'corpus-inventory.json'))

const paths: string[] = []
for await (const path of walk(RAW_ROOT)) {
  // A sparse checkout brings the directories above the data with it, so the
  // walk sees build files and C++ next to the documents. Only documents count.
  if (!isDocument(extname(path).toLowerCase())) continue
  paths.push(path)
}

console.log(`Reading ${String(paths.length)} files under ${RAW_ROOT} …`)

const entries = await mapLimit(paths, 8, async (path) => {
  try {
    return await inspect(path, RAW_ROOT)
  } catch (error) {
    // A file we cannot even stat is still a fact about the corpus.
    return {
      path,
      relative: path.replace(`${RAW_ROOT}/`, ''),
      source: path.replace(`${RAW_ROOT}/`, '').split('/')[0] ?? 'unknown',
      extension: '',
      size: 0,
      sha1: '',
      zip: false,
      contentTypes: false,
      bucket: 'hostile' as const,
      reason: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
      format: 'other' as const,
      generator: { application: null, version: null, slug: 'unknown' },
      parts: [],
      features: [],
      rows: null,
    }
  }
})

await writeFile(
  out,
  `${JSON.stringify({ root: RAW_ROOT, generated: new Date().toISOString(), entries }, null, 1)}\n`,
)

const corpus = entries.filter((entry) => entry.bucket === 'corpus')
const total = entries.reduce((sum, entry) => sum + entry.size, 0)

console.log(`\nWrote ${out}`)
console.log(`${String(entries.length)} files, ${formatBytes(total)}`)

table(
  'By bucket',
  tally(entries, (entry) => [entry.bucket]),
)
table(
  'By source',
  tally(entries, (entry) => [`${entry.source} (${entry.bucket})`]),
)
table(
  'By extension',
  tally(entries, (entry) => [entry.extension || '(none)']),
)
table(
  'By format (openable packages only)',
  tally(corpus, (entry) => [entry.format]),
)
table(
  'By generator (openable packages only)',
  tally(corpus, (entry) => [entry.generator.slug]),
)
table(
  'By application string, verbatim',
  tally(corpus, (entry) => [entry.generator.application ?? '(none)']),
  20,
)
table(
  'By feature (openable packages only)',
  tally(corpus, (entry) => entry.features),
)
table(
  'Why a file is hostile',
  tally(
    entries.filter((entry) => entry.bucket === 'hostile'),
    (entry) => [entry.reason ?? 'unknown'],
  ),
)
