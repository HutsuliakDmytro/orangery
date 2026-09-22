import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { formatBytes, formatOf, isOoxml, mapLimit, walk } from './lib'
import type { Result, Status } from './worker'

/**
 * Open, save, compare, open again — over every file of a corpus.
 *
 * The interesting outcomes are the ones a test framework cannot report. A file
 * that hangs has to be timed out by something outside the process doing the
 * work; a file that exhausts the heap kills that process rather than throwing;
 * and either way the run has to carry on and say which file it was. So the
 * work happens in child processes, a batch of files each, and this side watches
 * the clock and the exit codes.
 *
 * The worker is bundled once with esbuild rather than run through vite-node.
 * Three thousand files is a hundred and fifty child processes, and a Vite
 * transform of the whole editor on each of them costs more than the round-trips
 * do.
 *
 * Usage:
 *   pnpm corpus:run [--corpus tests/fixtures/office] [--out corpus-report.json]
 *                   [--timeout 30000] [--memory 1024] [--jobs 4] [--batch 50]
 */

function argumentValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const corpus = argumentValue('--corpus', join(process.cwd(), 'tests/fixtures/office'))
const out = argumentValue('--out', join(process.cwd(), 'corpus-report.json'))
const timeout = Number(argumentValue('--timeout', '30000'))
const memory = Number(argumentValue('--memory', '1024'))
const jobs = Number(argumentValue('--jobs', '4'))
const batchSize = Number(argumentValue('--batch', '50'))

const files: string[] = []
for await (const path of walk(corpus)) {
  // By extension rather than by format: `.doc` is a Word file and not a
  // package, and asking an OOXML reader to open one tells us only that.
  if (isOoxml(extname(path).toLowerCase())) files.push(path)
}
files.sort()

if (files.length === 0) {
  console.error(`No corpus files under ${corpus}.`)
  process.exit(1)
}

console.log(
  `${String(files.length)} files under ${corpus}; ${String(jobs)} workers, ${String(timeout)} ms and ${String(memory)} MB each.`,
)

const workspace = await mkdtemp(join(tmpdir(), 'orangery-corpus-'))
const worker = join(workspace, 'worker.mjs')

await build({
  entryPoints: [join(process.cwd(), 'scripts/corpus/worker.ts')],
  outfile: worker,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The editor's React components come along for the ride through the app's
  // own imports; none of them are rendered here, and leaving them out would
  // mean maintaining a list of what a round-trip does not touch.
  logLevel: 'error',
})
const results: Result[] = []
let done = 0

/** A result for a file whose process never reported one. */
function lost(file: string, status: Status, detail: string, ms: number): Result {
  return {
    file,
    format: formatOf(extname(file).toLowerCase()),
    size: 0,
    status,
    ms,
    phase: 'unknown',
    added: [],
    removed: [],
    binaryChanged: [],
    differences: [],
    benign: 0,
    unknown: 0,
    error: { message: detail, stack: '' },
  }
}

/**
 * Runs one batch to completion, restarting after every death.
 *
 * A child that dies takes the file it was holding with it: that file is the
 * result, and the rest of its batch goes to a fresh process.
 */
async function runBatch(shard: number, batch: string[]): Promise<void> {
  let remaining = [...batch]

  while (remaining.length > 0) {
    const tasksPath = join(workspace, `tasks-${String(shard)}-${String(remaining.length)}.json`)
    await writeFile(tasksPath, JSON.stringify(remaining))

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${String(memory)}`, worker, '--tasks', tasksPath],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )

    let current: string | null = null
    let startedAt = Date.now()
    let stderr = ''
    let buffer = ''
    let killed: 'timeout' | null = null

    const watchdog = setInterval(() => {
      if (current !== null && Date.now() - startedAt > timeout) {
        killed = 'timeout'
        child.kill('SIGKILL')
      }
    }, 500)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('@@')) {
          if (line.trim() !== '') console.log(`    ${line}`)
          continue
        }

        const message = JSON.parse(line.slice(2)) as
          { event: 'start'; file: string } | { event: 'result'; result: Result }

        if (message.event === 'start') {
          current = message.file
          startedAt = Date.now()
          continue
        }

        results.push(message.result)
        remaining = remaining.filter((file) => file !== message.result.file)
        current = null
        done += 1

        const mark =
          message.result.status === 'ok'
            ? 'ok  '
            : message.result.status === 'diff'
              ? 'diff'
              : message.result.status.toUpperCase()
        console.log(
          `  ${mark}  [${String(done)}/${String(files.length)}] ${message.result.file.split('/').pop() ?? ''} (${String(message.result.ms)} ms)`,
        )
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000)
    })

    const code = await new Promise<number | null>((resolve) => {
      child.on('close', (value) => {
        resolve(value)
      })
    })
    clearInterval(watchdog)

    if (current !== null) {
      const file = current
      const ms = Date.now() - startedAt
      // Out of memory says so on the way down; anything else that takes the
      // process with it is a crash we could not catch inside it.
      const status: Status =
        killed === 'timeout'
          ? 'timeout'
          : /heap out of memory|Allocation failed|Array buffer allocation failed/i.test(stderr)
            ? 'oom'
            : 'crash'

      results.push(
        lost(
          file,
          status,
          status === 'timeout'
            ? `no result after ${String(timeout)} ms`
            : `worker exited with ${String(code)}: ${stderr.trim().split('\n').slice(-6).join(' | ')}`,
          ms,
        ),
      )
      remaining = remaining.filter((one) => one !== file)
      done += 1
      console.log(
        `  ${status.toUpperCase()}  [${String(done)}/${String(files.length)}] ${file.split('/').pop() ?? ''}`,
      )
      continue
    }

    if (remaining.length > 0 && code !== 0) {
      // The process died between files, which is nobody's fault in particular;
      // the rest of the batch still has to run.
      console.log(`  worker for shard ${String(shard)} exited with ${String(code)}; restarting`)
    }
  }
}

const batches: string[][] = []
for (let index = 0; index < files.length; index += batchSize) {
  batches.push(files.slice(index, index + batchSize))
}

const started = Date.now()
await mapLimit(batches, jobs, async (batch, index) => {
  await runBatch(index, batch)
})
await rm(workspace, { recursive: true, force: true })

results.sort((a, b) => a.file.localeCompare(b.file))

const counted = (status: Status): Result[] => results.filter((one) => one.status === status)
const summary = {
  corpus,
  files: results.length,
  ms: Date.now() - started,
  byStatus: Object.fromEntries(
    (['ok', 'diff', 'crash', 'timeout', 'oom'] as Status[]).map((status) => [
      status,
      counted(status).length,
    ]),
  ),
  byFormat: Object.fromEntries(
    ['docx', 'pptx', 'xlsx'].map((format) => {
      const forFormat = results.filter((one) => one.format === format)
      return [
        format,
        Object.fromEntries(
          (['ok', 'diff', 'crash', 'timeout', 'oom'] as Status[]).map((status) => [
            status,
            forFormat.filter((one) => one.status === status).length,
          ]),
        ),
      ]
    }),
  ),
}

await writeFile(
  out,
  `${JSON.stringify({ generated: new Date().toISOString(), summary, results }, null, 1)}\n`,
)

console.log(`\n${out}`)
console.log(
  `${String(results.length)} files in ${(summary.ms / 1000).toFixed(0)} s — ` +
    Object.entries(summary.byStatus)
      .map(([status, count]) => `${status} ${String(count)}`)
      .join(', '),
)

for (const [format, counts] of Object.entries(summary.byFormat)) {
  console.log(
    `  ${format}  ` +
      Object.entries(counts)
        .map(([status, count]) => `${status} ${String(count)}`)
        .join(', '),
  )
}

const worst = results
  .filter((one) => one.status !== 'ok')
  .sort((a, b) => b.unknown - a.unknown)
  .slice(0, 10)

if (worst.length > 0) {
  console.log('\nWorst of it:')
  for (const one of worst) {
    console.log(
      `  ${one.status.padEnd(7)} ${one.file.split('/').pop() ?? ''} — ${
        one.error?.message ??
        `${String(one.unknown)} unexplained differences in ${String(one.differences.length)} part(s), ${formatBytes(one.size)}`
      }`,
    )
  }
}
