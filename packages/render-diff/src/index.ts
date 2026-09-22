/**
 * Visual round-trip check.
 *
 * Structural XML equality is necessary but not sufficient: two files can differ
 * structurally and render identically, and — the case that matters — they can
 * match structurally while rendering differently, because meaning lives in the
 * parts nobody was looking at as much as in the one that was edited.
 *
 * So each corpus file is rendered to PDF through headless LibreOffice, put
 * through open → save, rendered again, and the two rasterised page sets are
 * compared pixel by pixel.
 *
 * Nothing here knows what a document or a deck is. The caller says where its
 * corpus lives, what its files are called, and what a round-trip means for it;
 * everything else — the rendering, the rasterising, the comparing — is the same
 * question asked of two formats.
 *
 * Requires `soffice` (LibreOffice) and `pdftoppm` (poppler) on PATH.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const run = promisify(execFile)

/** Fraction of differing pixels a page may have before it counts as a failure. */
export const DEFAULT_THRESHOLD = 0.001

/** Per-pixel colour tolerance: font rasterisation is not bit-exact between runs. */
export const PIXEL_TOLERANCE = 0.1

export interface RenderDiffOptions {
  /** The directory holding `synthetic/` and `real/`. */
  corpus: string
  /** What the files are called, with the dot: `.docx`, `.pptx`. */
  extension: string
  /** Where a failing page's diff image is written. */
  output: string
  /** Open the file at `input`, save it to `output`, and change nothing else. */
  roundTrip: (input: string, output: string) => Promise<void>
  /** `process.argv.slice(2)`, for the two flags this takes. */
  argv?: string[]
  /**
   * The subdirectories of `corpus` to look in, if not `synthetic` and `real`.
   *
   * An app's own corpus is split by where the files came from; the office
   * corpus in `tests/fixtures/office` is split by format, because a hundred
   * and forty files in one directory is not a thing anybody can look at.
   */
  groups?: readonly string[]
}

export interface Arguments {
  threshold: number
  keep: boolean
}

export function parseArgs(argv: readonly string[]): Arguments {
  const args: Arguments = { threshold: DEFAULT_THRESHOLD, keep: false }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--threshold') {
      args.threshold = Number.parseFloat(argv[index + 1] ?? '')
      index += 1
    } else if (argv[index] === '--keep') {
      args.keep = true
    }
  }

  if (!Number.isFinite(args.threshold)) args.threshold = DEFAULT_THRESHOLD
  return args
}

async function requireTool(name: string): Promise<void> {
  try {
    await run('which', [name])
  } catch {
    throw new Error(
      `${name} is not on PATH. Install LibreOffice (soffice) and poppler (pdftoppm) to run the render diff.`,
    )
  }
}

async function toPdf(inputPath: string, outputDir: string): Promise<string> {
  await run(
    'soffice',
    [
      '--headless',
      '--norestore',
      // A private profile keeps parallel runs from fighting over one config dir.
      `-env:UserInstallation=file://${join(outputDir, 'profile')}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputPath,
    ],
    { timeout: 120_000 },
  )

  const produced = (await readdir(outputDir)).find((name) => name.endsWith('.pdf'))
  if (produced === undefined) throw new Error(`LibreOffice produced no PDF for ${inputPath}`)
  return join(outputDir, produced)
}

async function toPages(pdfPath: string, outputDir: string, prefix: string): Promise<string[]> {
  await run('pdftoppm', ['-png', '-r', '100', pdfPath, join(outputDir, prefix)], {
    timeout: 120_000,
  })

  return (await readdir(outputDir))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
    .sort()
    .map((name) => join(outputDir, name))
}

export interface ComparisonResult {
  ok: boolean
  detail?: string
}

/**
 * Compares two sets of rendered pages.
 *
 * A page that differs is written out as a diff image rather than described:
 * "0.4% of pixels differ" says nothing about whether a heading moved or a table
 * lost its lines, and the image says it at a glance.
 */
export async function comparePages(
  beforePages: readonly string[],
  afterPages: readonly string[],
  label: string,
  threshold: number,
  output: string,
): Promise<ComparisonResult> {
  if (beforePages.length !== afterPages.length) {
    return {
      ok: false,
      detail: `page count changed: ${String(beforePages.length)} → ${String(afterPages.length)}`,
    }
  }

  for (let index = 0; index < beforePages.length; index += 1) {
    const before = PNG.sync.read(await readFile(beforePages[index] ?? ''))
    const after = PNG.sync.read(await readFile(afterPages[index] ?? ''))

    if (before.width !== after.width || before.height !== after.height) {
      return { ok: false, detail: `page ${String(index + 1)} changed size` }
    }

    const diff = new PNG({ width: before.width, height: before.height })
    const differing = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {
      threshold: PIXEL_TOLERANCE,
    })

    const fraction = differing / (before.width * before.height)
    if (fraction > threshold) {
      await mkdir(output, { recursive: true })
      const diffPath = join(output, `${label}-page${String(index + 1)}.png`)
      await writeFile(diffPath, PNG.sync.write(diff))

      return {
        ok: false,
        detail: `page ${String(index + 1)}: ${(fraction * 100).toFixed(3)}% of pixels differ (diff written to ${diffPath})`,
      }
    }
  }

  return { ok: true }
}

/**
 * Every file in the corpus, synthetic and real alike.
 *
 * A missing directory is not an error: `real/` is empty in a fresh checkout and
 * stays that way until somebody puts files there that are fine to keep in a
 * public repository.
 */
export async function corpusFiles(
  corpus: string,
  extension: string,
  groups: readonly string[] = ['synthetic', 'real'],
): Promise<{ label: string; path: string }[]> {
  const files: { label: string; path: string }[] = []

  for (const group of groups) {
    const directory = join(corpus, group)

    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }

    for (const entry of entries) {
      // `~$` is the lock file an Office program leaves beside an open document.
      if (!entry.endsWith(extension) || entry.startsWith('~$')) continue
      files.push({ label: `${group}/${entry}`, path: join(directory, entry) })
    }
  }

  return files
}

/** Runs the whole check and returns the number of files that render differently. */
export async function renderDiff(options: RenderDiffOptions): Promise<number> {
  const args = parseArgs(options.argv ?? [])

  await requireTool('soffice')
  await requireTool('pdftoppm')

  const files = await corpusFiles(options.corpus, options.extension, options.groups)
  if (files.length === 0) {
    throw new Error(`No corpus files found in ${options.corpus}.`)
  }

  const failures: string[] = []

  for (const file of files) {
    const workspace = await mkdtemp(join(tmpdir(), 'orangery-render-'))

    try {
      const savedPath = join(workspace, `after${options.extension}`)
      await options.roundTrip(file.path, savedPath)

      const beforeDir = join(workspace, 'before')
      const afterDir = join(workspace, 'after')
      await mkdir(beforeDir, { recursive: true })
      await mkdir(afterDir, { recursive: true })

      const beforePages = await toPages(await toPdf(file.path, beforeDir), beforeDir, 'page')
      const afterPages = await toPages(await toPdf(savedPath, afterDir), afterDir, 'page')

      const label = file.label.replace(/[^\w.-]/gu, '_')
      const result = await comparePages(
        beforePages,
        afterPages,
        label,
        args.threshold,
        options.output,
      )

      if (result.ok) {
        console.log(`  ok   ${file.label} (${String(beforePages.length)} page(s))`)
      } else {
        console.log(`  FAIL ${file.label} — ${result.detail ?? 'unknown difference'}`)
        failures.push(`${file.label}: ${result.detail ?? 'unknown difference'}`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.log(`  FAIL ${file.label} — ${detail}`)
      failures.push(`${file.label}: ${detail}`)
    } finally {
      if (!args.keep) await rm(workspace, { recursive: true, force: true })
    }
  }

  console.log()
  if (failures.length > 0) {
    console.error(
      `${String(failures.length)} of ${String(files.length)} file(s) render differently after a round-trip:`,
    )
    for (const failure of failures) console.error(`  - ${failure}`)
  } else {
    console.log(`All ${String(files.length)} file(s) render identically after a round-trip.`)
  }

  return failures.length
}

/**
 * Runs the check as a command: report, then leave with the right status.
 *
 * The tools missing is an ordinary answer — nobody has LibreOffice installed
 * because they are editing a slide — so it is a sentence rather than a stack
 * trace, and it lives here so both apps say it the same way.
 */
export async function main(options: RenderDiffOptions): Promise<never> {
  try {
    const failures = await renderDiff(options)
    process.exit(failures > 0 ? 1 : 0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
