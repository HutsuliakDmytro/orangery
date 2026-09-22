import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { compareXml, isTextPart, readPackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { openDocx, saveDocx } from '../../apps/docs/src/document/docx-file'
import { openWorkbook } from '../../apps/sheets/src/document/workbook'
import { workbookBytes } from '../../apps/sheets/src/document/save'
import {
  readDeck,
  readPptxPackage,
  rewriteEveryPart,
  saveDeck,
} from '../../packages/ooxml-presentation/src/index'
import { comparable } from './normalise'
import { classify, classifyPart } from './whitelist'
import { formatOf } from './lib'
import type { Format } from './lib'

/**
 * One file, opened and saved by the app that owns it.
 *
 * Run as a child process by `run.ts`, a batch at a time, and expected to die:
 * a file that hangs takes the process with it and a file that runs out of
 * memory takes the heap, which is exactly why this is not a function call.
 * Each result is printed as one line the moment it is known, so the parent
 * knows which file was in hand when the process stopped answering.
 *
 * Saving is asked to regenerate rather than to pass through. Saving a file
 * nobody edited writes most parts back from the buffers they were read into,
 * which would compare equal without having tested anything; the serialiser is
 * the thing under test, so it is made to run.
 */

export type Status = 'ok' | 'diff' | 'crash' | 'timeout' | 'oom'

export interface PartDifference {
  part: string
  count: number
  samples: { path: string; message: string; rule: string | null }[]
}

export interface Result {
  file: string
  format: Format
  size: number
  status: Status
  ms: number
  phase: string
  added: string[]
  removed: string[]
  binaryChanged: string[]
  differences: PartDifference[]
  /** How the differences sorted: forgiven by a whitelist rule, or not. */
  benign: number
  unknown: number
  error: { message: string; stack: string } | null
}

async function roundTrip(format: Format, bytes: Uint8Array): Promise<Uint8Array> {
  if (format === 'docx') {
    const open = await openDocx(bytes)
    return await saveDocx(open, open.doc)
  }

  if (format === 'pptx') {
    const pkg = await readPptxPackage(bytes)
    rewriteEveryPart(pkg, readDeck(pkg))
    return await saveDeck(pkg)
  }

  const open = await openWorkbook(bytes)
  // `edited` is what makes the writer run over every sheet rather than putting
  // the bytes back; a round-trip that skips the writer tests nothing.
  return await workbookBytes(open, { edited: true })
}

async function reopen(format: Format, bytes: Uint8Array): Promise<void> {
  if (format === 'docx') await openDocx(bytes)
  else if (format === 'pptx') readDeck(await readPptxPackage(bytes))
  else await openWorkbook(bytes)
}

function compare(
  before: OoxmlPackage,
  after: OoxmlPackage,
): Omit<Result, keyof Result> & {
  added: string[]
  removed: string[]
  binaryChanged: string[]
  differences: PartDifference[]
  benign: number
  unknown: number
} {
  const added = [...after.parts.keys()].filter((path) => !before.parts.has(path))
  const removed = [...before.parts.keys()].filter((path) => !after.parts.has(path))
  const changed = new Set([...added, ...removed])
  const binaryChanged: string[] = []
  const differences: PartDifference[] = []
  let benign = 0
  let unknown = 0

  for (const [path, part] of before.parts) {
    const other = after.parts.get(path)
    if (other === undefined) continue

    if (!isTextPart(path)) {
      // Media and `vbaProject.bin` are carried, never rewritten; a byte that
      // moved here is the preservation guarantee failing outright.
      if (Buffer.compare(Buffer.from(part.bytes), Buffer.from(other.bytes)) !== 0) {
        binaryChanged.push(path)
      }
      continue
    }

    const found = compareXml(
      comparable(path, part.text ?? '', changed),
      comparable(path, other.text ?? '', changed),
    )
    if (found.length === 0) continue

    const samples = found.slice(0, 5).map((difference) => ({
      path: difference.path,
      message: difference.message,
      rule: classify(path, difference.path, difference.message).rule,
    }))

    for (const difference of found) {
      if (classify(path, difference.path, difference.message).rule === null) unknown += 1
      else benign += 1
    }

    differences.push({ part: path, count: found.length, samples })
  }

  for (const path of added) {
    if (classifyPart(path, 'added').rule === null) unknown += 1
    else benign += 1
  }
  for (const path of removed) {
    if (classifyPart(path, 'removed').rule === null) unknown += 1
    else benign += 1
  }

  return { added, removed, binaryChanged, differences, benign, unknown }
}

async function one(file: string): Promise<Result> {
  const started = Date.now()
  const format = formatOf(extname(file).toLowerCase())
  const base: Result = {
    file,
    format,
    size: 0,
    status: 'ok',
    ms: 0,
    phase: 'read',
    added: [],
    removed: [],
    binaryChanged: [],
    differences: [],
    benign: 0,
    unknown: 0,
    error: null,
  }

  try {
    const bytes = new Uint8Array(await readFile(file))
    base.size = bytes.byteLength

    base.phase = 'open'
    const before = await readPackage(bytes)

    base.phase = 'save'
    const saved = await roundTrip(format, bytes)

    base.phase = 'compare'
    const after = await readPackage(saved)
    Object.assign(base, compare(before, after))

    base.phase = 'reopen'
    await reopen(format, saved)

    base.phase = 'done'
    base.status =
      base.differences.length > 0 || base.binaryChanged.length > 0 || base.removed.length > 0
        ? 'diff'
        : 'ok'
  } catch (error) {
    base.status = 'crash'
    base.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? '') : '',
    }
  }

  base.ms = Date.now() - started
  return base
}

const tasksPath = process.argv[process.argv.indexOf('--tasks') + 1] ?? ''
const tasks = JSON.parse(await readFile(tasksPath, 'utf8')) as string[]

for (const file of tasks) {
  process.stdout.write(`@@${JSON.stringify({ event: 'start', file })}\n`)
  const result = await one(file)
  process.stdout.write(`@@${JSON.stringify({ event: 'result', result })}\n`)
}
