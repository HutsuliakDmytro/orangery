/**
 * Visual round-trip check.
 *
 * Structural XML equality is necessary but not sufficient: two documents can
 * differ structurally and render identically, and — the case that matters —
 * they can match structurally while rendering differently, because meaning
 * lives in styles.xml and numbering.xml as much as in document.xml.
 *
 * So each corpus file is rendered to PDF through headless LibreOffice, put
 * through open → save, rendered again, and the two rasterised page sets are
 * compared pixel by pixel.
 *
 * Requires `soffice` (LibreOffice) and `pdftoppm` (poppler) on PATH.
 *
 * Usage: pnpm test:render [--threshold 0.001] [--keep]
 */

import { getPartText, setPartText, writePackage } from '@orangery/ooxml-core'
import { DOCUMENT_PART, readDocxPackage } from '../src/ooxml/parts'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { parseDocument } from '../src/ooxml/parse-document'
import { serializeParsed } from '../src/ooxml/serialize-document'

const run = promisify(execFile)

const CORPUS = join(process.cwd(), 'tests/fixtures/docx')
const OUTPUT = join(process.cwd(), 'test-results/render-diff')

/** Fraction of differing pixels a page may have before it counts as a failure. */
export const DEFAULT_THRESHOLD = 0.001

/** Per-pixel colour tolerance: font rasterisation is not bit-exact between runs. */
export const PIXEL_TOLERANCE = 0.1

function parseArgs(argv: string[]): { threshold: number; keep: boolean } {
  const args = { threshold: DEFAULT_THRESHOLD, keep: false }
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
  if (!produced) throw new Error(`LibreOffice produced no PDF for ${inputPath}`)
  return join(outputDir, produced)
}

async function toPages(pdfPath: string, outputDir: string, prefix: string): Promise<string[]> {
  await run('pdftoppm', ['-png', '-r', '100', pdfPath, join(outputDir, prefix)], {
    timeout: 120_000,
  })

  const pages = (await readdir(outputDir))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
    .sort()

  return pages.map((name) => join(outputDir, name))
}

export interface ComparisonResult {
  ok: boolean
  detail?: string
}

export async function comparePages(
  beforePages: string[],
  afterPages: string[],
  label: string,
  threshold: number,
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
      await mkdir(OUTPUT, { recursive: true })
      const diffPath = join(OUTPUT, `${label}-page${String(index + 1)}.png`)
      await writeFile(diffPath, PNG.sync.write(diff))
      return {
        ok: false,
        detail: `page ${String(index + 1)}: ${(fraction * 100).toFixed(3)}% of pixels differ (diff written to ${diffPath})`,
      }
    }
  }

  return { ok: true }
}

export async function corpusFiles(): Promise<{ label: string; path: string }[]> {
  const files: { label: string; path: string }[] = []
  for (const group of ['synthetic', 'real']) {
    const directory = join(CORPUS, group)
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

async function roundTrip(inputPath: string, outputPath: string): Promise<void> {
  const pkg = await readDocxPackage(await readFile(inputPath))
  const parsed = parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')
  setPartText(pkg, DOCUMENT_PART, serializeParsed(parsed))
  await writeFile(outputPath, await writePackage(pkg))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  await requireTool('soffice')
  await requireTool('pdftoppm')

  const files = await corpusFiles()
  if (files.length === 0) {
    console.error('No corpus files found in tests/fixtures/docx.')
    process.exit(1)
  }

  const failures: string[] = []

  for (const file of files) {
    const workspace = await mkdtemp(join(tmpdir(), 'orangery-render-'))
    try {
      const savedPath = join(workspace, 'after.docx')
      await roundTrip(file.path, savedPath)

      const beforeDir = join(workspace, 'before')
      const afterDir = join(workspace, 'after')
      await mkdir(beforeDir, { recursive: true })
      await mkdir(afterDir, { recursive: true })

      const beforePdf = await toPdf(file.path, beforeDir)
      const afterPdf = await toPdf(savedPath, afterDir)

      const beforePages = await toPages(beforePdf, beforeDir, 'page')
      const afterPages = await toPages(afterPdf, afterDir, 'page')

      const label = file.label.replace(/[^\w.-]/gu, '_')
      const result = await comparePages(beforePages, afterPages, label, args.threshold)

      if (result.ok) {
        console.log(`  ok   ${file.label} (${String(beforePages.length)} page(s))`)
      } else {
        console.log(`  FAIL ${file.label} — ${result.detail ?? 'unknown difference'}`)
        failures.push(`${file.label}: ${result.detail ?? 'unknown difference'}`)
      }
    } catch (error) {
      console.log(
        `  FAIL ${file.label} — ${error instanceof Error ? error.message : String(error)}`,
      )
      failures.push(`${file.label}: ${error instanceof Error ? error.message : String(error)}`)
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
    process.exit(1)
  }

  console.log(`All ${String(files.length)} file(s) render identically after a round-trip.`)
}

// Importing this module (from a test) must not launch LibreOffice.
if (process.argv[1]?.includes('render-diff')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
