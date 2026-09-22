import { copyFile, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Entry, Format, formatBytes, FULL_ROOT, PUBLIC_ROOT, readInventory } from './lib'

/**
 * Which files go into the repository, and where the rest of them live.
 *
 * The public corpus is not "everything that fits" — it is a matrix of feature
 * against generator, two files to a cell, so that a failure says which feature
 * and whose writer rather than only which file. The budget is small on purpose:
 * a hundred and fifty files nobody minds cloning beats three thousand nobody
 * can.
 *
 * Everything else — including every LibreOffice file, which is MPL and cannot
 * be committed at all — is hard-linked into `~/corpus-full` for the runs that
 * set `ORANGERY_CORPUS`.
 *
 * Usage: pnpm corpus:select [--inventory corpus-inventory.json] [--dry-run]
 */

/** Sources whose licence allows a file to be committed — see `~/corpus-raw/LICENSES.md`. */
const COMMITTABLE = new Set(['poi', 'python-docx', 'python-pptx'])

const FILE_BUDGET = 150
const SIZE_BUDGET = 50 * 1024 * 1024

/** A file bigger than this is only taken when the cell has nothing else. */
const COMFORTABLE = 1024 * 1024
const MAXIMUM = 6 * 1024 * 1024

interface Cell {
  feature: string
  want: number
}

/**
 * The matrix from `CORPUS.md` step 2, in the order it is filled.
 *
 * Order is the budget's tie-breaker: what comes first gets its files even if
 * the count runs out, so charts — which three blocked plan items wait on — are
 * ahead of the things that merely ought to be covered. The counts for charts
 * and for formulas are what those plan items ask for: thirty charts to render
 * and twenty workbooks to recalculate.
 */
const MATRIX: Record<Exclude<Format, 'other'>, Cell[]> = {
  docx: [
    { feature: 'charts', want: 3 },
    { feature: 'numbering', want: 2 },
    { feature: 'tables', want: 2 },
    { feature: 'anchored', want: 2 },
    { feature: 'inlineimage', want: 2 },
    { feature: 'sections', want: 2 },
    { feature: 'headers', want: 2 },
    { feature: 'footnotes', want: 2 },
    { feature: 'fields', want: 2 },
    { feature: 'toc', want: 2 },
    { feature: 'comments', want: 2 },
    { feature: 'trackchanges', want: 2 },
    { feature: 'stylesheavy', want: 2 },
    { feature: 'math', want: 2 },
    { feature: 'rtl', want: 2 },
    { feature: 'cjk', want: 2 },
    { feature: 'sdt', want: 2 },
    { feature: 'smartart', want: 1 },
    { feature: 'embeddings', want: 1 },
    { feature: 'vba', want: 1 },
    { feature: 'plain', want: 2 },
  ],
  pptx: [
    { feature: 'charts', want: 8 },
    { feature: 'multimaster', want: 2 },
    { feature: 'manylayouts', want: 2 },
    { feature: 'placeholders', want: 2 },
    { feature: 'groups', want: 2 },
    { feature: 'tables', want: 2 },
    { feature: 'smartart', want: 2 },
    { feature: 'media', want: 2 },
    { feature: 'av', want: 1 },
    { feature: 'animations', want: 2 },
    { feature: 'transitions', want: 2 },
    { feature: 'notes', want: 2 },
    { feature: 'sections', want: 1 },
    { feature: 'customgeometry', want: 2 },
    { feature: 'comments', want: 1 },
    { feature: 'plain', want: 2 },
  ],
  xlsx: [
    { feature: 'charts', want: 8 },
    { feature: 'numfmt', want: 2 },
    { feature: 'sharedstrings', want: 2 },
    { feature: 'inlinestrings', want: 2 },
    { feature: 'formulas', want: 8 },
    { feature: 'sharedformulas', want: 4 },
    { feature: 'arrayformulas', want: 4 },
    { feature: 'dynamicarrays', want: 1 },
    { feature: 'definednames', want: 2 },
    { feature: 'tables', want: 2 },
    { feature: 'conditional', want: 2 },
    { feature: 'validation', want: 2 },
    { feature: 'merges', want: 2 },
    { feature: 'freeze', want: 2 },
    { feature: 'pivots', want: 2 },
    { feature: 'vba', want: 2 },
    { feature: 'comments', want: 2 },
    { feature: 'externallinks', want: 2 },
    { feature: 'date1904', want: 2 },
    { feature: 'large', want: 1 },
    { feature: 'plain', want: 2 },
  ],
}

function argumentValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

/**
 * Whether the file is one the app is meant to be able to show.
 *
 * A `.pptx` with no slides in it is a legitimate package — PowerPoint writes
 * one for a template — but there is nothing in it to draw, and the deck tests
 * are written around a deck having slides. It stays in the full corpus, where
 * the round-trip run still opens it.
 */
function isWorthShowing(entry: Entry): boolean {
  if (entry.format !== 'pptx') return true
  return entry.parts.some((part) => /ppt\/slides\/slide\d+\.xml$/.test(part))
}

/** Whether an entry answers to a cell of the matrix. */
function matches(entry: Entry, feature: string): boolean {
  if (feature === 'plain') return entry.features.length <= 1
  // Large in the sense that matters to a round-trip: bytes to re-serialise,
  // or rows to walk. A sparse sheet whose last row is a million is neither.
  if (feature === 'large') return (entry.rows ?? 0) >= 50_000 || entry.size >= 500_000
  return entry.features.includes(feature)
}

interface Chosen {
  entry: Entry
  feature: string
  name: string
}

const inventoryPath = argumentValue('--inventory', join(process.cwd(), 'corpus-inventory.json'))
const dryRun = process.argv.includes('--dry-run')

const inventory = await readInventory(inventoryPath)
const entries = [...inventory.entries].sort((a, b) => a.relative.localeCompare(b.relative))

const seenHash = new Set<string>()
const deduplicated = entries.filter((entry) => {
  if (entry.sha1 === '' || !seenHash.has(entry.sha1)) {
    seenHash.add(entry.sha1)
    return true
  }
  return false
})

const openable = deduplicated.filter((entry) => entry.bucket === 'corpus')
const chosen: Chosen[] = []
const taken = new Set<string>()
let size = 0

for (const [format, cells] of Object.entries(MATRIX) as [Exclude<Format, 'other'>, Cell[]][]) {
  const pool = openable.filter(
    (entry) =>
      entry.format === format &&
      COMMITTABLE.has(entry.source) &&
      entry.size <= MAXIMUM &&
      isWorthShowing(entry),
  )

  for (const cell of cells) {
    const used = new Map<string, number>()
    let picked = 0

    const candidates = pool
      .filter((entry) => !taken.has(entry.path) && matches(entry, cell.feature))
      // A generator we have not used for this cell first, then the smallest
      // file: two writers disagreeing is the point of a cell, and a small file
      // is the one somebody can actually read when it fails.
      .sort((a, b) => {
        const comfortable = (entry: Entry) => (entry.size <= COMFORTABLE ? 0 : 1)
        return comfortable(a) - comfortable(b) || a.size - b.size
      })

    for (const entry of candidates) {
      if (picked >= cell.want) break
      if (chosen.length >= FILE_BUDGET || size + entry.size > SIZE_BUDGET) break

      const generator = entry.generator.slug
      const already = used.get(generator) ?? 0
      // Two files from one writer only once the other writers are exhausted.
      if (
        already > 0 &&
        candidates.some(
          (other) =>
            (used.get(other.generator.slug) ?? 0) === 0 &&
            !taken.has(other.path) &&
            other !== entry,
        )
      ) {
        continue
      }

      used.set(generator, already + 1)
      taken.add(entry.path)
      picked += 1
      size += entry.size

      const index = chosen.filter(
        (one) => one.feature === cell.feature && one.entry.generator.slug === generator,
      ).length
      const extension = entry.extension
      chosen.push({
        entry,
        feature: cell.feature,
        name: `${generator}-${cell.feature}-${String(index + 1).padStart(2, '0')}${extension}`,
      })
    }
  }
}

/**
 * What is left of the budget, spent on breadth.
 *
 * The matrix fills its cells and stops, which leaves room: a hundred files of
 * six megabytes against a budget of a hundred and fifty and fifty. The rest
 * goes to whichever files carry the most features that are still thin, which
 * is how a corpus comes to hold combinations nobody thought to ask for.
 */
const seen = new Map<string, number>()
for (const one of chosen) {
  for (const feature of one.entry.features) {
    const key = `${one.entry.format}/${feature}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
}

const rest = openable.filter(
  (entry) =>
    !taken.has(entry.path) &&
    COMMITTABLE.has(entry.source) &&
    entry.format !== 'other' &&
    entry.size <= COMFORTABLE * 2 &&
    isWorthShowing(entry),
)

for (;;) {
  if (chosen.length >= FILE_BUDGET) break

  const scored = rest
    .filter((entry) => !taken.has(entry.path) && size + entry.size <= SIZE_BUDGET)
    .map((entry) => ({
      entry,
      score: entry.features.filter((feature) => (seen.get(`${entry.format}/${feature}`) ?? 0) < 3)
        .length,
    }))
    .sort((a, b) => b.score - a.score || a.entry.size - b.entry.size)

  const best = scored[0]
  if (best === undefined || best.score === 0) break

  const entry = best.entry
  taken.add(entry.path)
  size += entry.size
  for (const feature of entry.features) {
    const key = `${entry.format}/${feature}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  // Named for the thinnest feature it brought, which is why it was taken.
  const feature =
    [...entry.features].sort(
      (a, b) =>
        (seen.get(`${entry.format}/${a}`) ?? 0) - (seen.get(`${entry.format}/${b}`) ?? 0) ||
        a.localeCompare(b),
    )[0] ?? 'mixed'

  const index = chosen.filter(
    (one) => one.feature === feature && one.entry.generator.slug === entry.generator.slug,
  ).length

  chosen.push({
    entry,
    feature,
    name: `${entry.generator.slug}-${feature}-${String(index + 1).padStart(2, '0')}${entry.extension}`,
  })
}

console.log(
  `Public corpus: ${String(chosen.length)} files, ${formatBytes(size)} (budget ${String(FILE_BUDGET)} / ${formatBytes(SIZE_BUDGET)})`,
)

const byFormat = new Map<string, number>()
for (const one of chosen) byFormat.set(one.entry.format, (byFormat.get(one.entry.format) ?? 0) + 1)
for (const [format, count] of [...byFormat].sort()) console.log(`  ${format}  ${String(count)}`)

const missed = Object.entries(MATRIX).flatMap(([format, cells]) =>
  cells
    .filter(
      (cell) => !chosen.some((one) => one.entry.format === format && one.feature === cell.feature),
    )
    .map((cell) => `${format}/${cell.feature}`),
)
if (missed.length > 0) console.log(`\nEmpty matrix cells: ${missed.join(', ')}`)

if (dryRun) process.exit(0)

// The public corpus is rebuilt from scratch: a selection that quietly kept a
// file it no longer chooses would make the run unreproducible.
for (const format of ['docx', 'pptx', 'xlsx']) {
  await rm(join(process.cwd(), PUBLIC_ROOT, format), { recursive: true, force: true })
  await mkdir(join(process.cwd(), PUBLIC_ROOT, format), { recursive: true })
}

for (const one of chosen) {
  await copyFile(one.entry.path, join(process.cwd(), PUBLIC_ROOT, one.entry.format, one.name))
}

const manifest = chosen.map((one) => ({
  name: one.name,
  format: one.entry.format,
  feature: one.feature,
  features: one.entry.features,
  generator: one.entry.generator,
  source: one.entry.source,
  origin: one.entry.relative,
  size: one.entry.size,
  sha1: one.entry.sha1,
}))

await writeFile(
  join(process.cwd(), PUBLIC_ROOT, 'manifest.json'),
  `${JSON.stringify(manifest, null, 1)}\n`,
)

// Everything else, hard-linked rather than copied: same volume, no second copy
// of a quarter of a gigabyte, and a broken link is a louder failure than a
// stale duplicate.
const buckets: Record<string, Entry[]> = { legacy: [], hostile: [] }
for (const format of ['docx', 'pptx', 'xlsx', 'other']) buckets[format] = []

for (const entry of deduplicated) {
  if (taken.has(entry.path)) continue
  const where = entry.bucket === 'corpus' ? entry.format : entry.bucket
  buckets[where]?.push(entry)
}

await rm(FULL_ROOT, { recursive: true, force: true })

let linked = 0
for (const [where, list] of Object.entries(buckets)) {
  if (list.length === 0) continue
  await mkdir(join(FULL_ROOT, where), { recursive: true })

  for (const entry of list) {
    const flat = entry.relative.replace(/[/\\]/g, '_')
    const target = join(FULL_ROOT, where, flat)
    try {
      await link(entry.path, target)
    } catch {
      await copyFile(entry.path, target)
    }
    linked += 1
  }
}

await writeFile(
  join(FULL_ROOT, 'README.md'),
  [
    '# The full corpus',
    '',
    'Hard links into `~/corpus-raw`, laid out by what each file is. Never',
    'committed: it holds LibreOffice test data, which is MPL-2.0.',
    '',
    'Point a run at it with `ORANGERY_CORPUS=~/corpus-full`, and at one of its',
    'directories to ask about one format.',
    '',
    `Built ${new Date().toISOString()} from ${inventoryPath}.`,
    '',
    ...Object.entries(buckets)
      .filter(([, list]) => list.length > 0)
      .map(([where, list]) => `- \`${where}/\` — ${String(list.length)} files`),
    '',
  ].join('\n'),
)

const licences = await readFile(join(inventory.root, 'LICENSES.md'), 'utf8').catch(() => '')
if (licences !== '') {
  await writeFile(join(process.cwd(), PUBLIC_ROOT, 'LICENSES.md'), licences)
}

console.log(`\nFull corpus: ${String(linked)} files under ${FULL_ROOT}`)
