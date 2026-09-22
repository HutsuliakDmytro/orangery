import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartView, readChart } from '../../packages/charts/src/index'
import { readCorpus } from '../../packages/charts/src/corpus'

/**
 * Every chart in the corpus, drawn, so that somebody can look at them.
 *
 * The corpus test asks whether a chart parses and survives a round-trip, which
 * a chart drawn with its axes upside down passes. The only test for that is a
 * person looking at the picture beside the original, and this is what gives
 * them the picture: one SVG per chart part, named for the file it came from.
 *
 * Usage: pnpm corpus:charts [--corpus tests/fixtures/office] [--out corpus-charts]
 */

function argumentValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const out = argumentValue('--out', join(process.cwd(), 'corpus-charts'))

// `readCorpus`'s own default is relative to a package directory, because the
// test that uses it runs from one; from the repository root it has to be said.
const corpus = argumentValue(
  '--corpus',
  process.env['ORANGERY_CORPUS'] ?? join(process.cwd(), 'tests/fixtures/office'),
)

const charts = await readCorpus(corpus)
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const context = { scheme: new Map(), map: new Map() }
const index: string[] = [
  '<!doctype html><meta charset="utf-8"><title>The corpus, drawn</title>',
  '<style>body{font:13px system-ui;margin:2rem;background:#fafafa}',
  'figure{display:inline-block;margin:0 1rem 1.5rem 0;background:#fff;border:1px solid #ddd;padding:.5rem}',
  'figcaption{font-size:11px;color:#555;max-width:420px}</style>',
  `<h1>${String(charts.length)} charts</h1>`,
]

let drawn = 0
let framed = 0

for (const chart of charts) {
  const read = readChart(chart.xml)
  if (read === null) continue

  const name = `${chart.file}-${chart.part.split('/').pop() ?? ''}`.replace(/[^\w.-]/gu, '_')

  if (read.unsupported !== null) {
    framed += 1
    index.push(
      `<figure><div style="width:420px;height:60px;display:grid;place-items:center;color:#999">framed: ${read.unsupported}</div><figcaption>${name}</figcaption></figure>`,
    )
    continue
  }

  const svg = renderToStaticMarkup(
    createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 4800000 3000000',
        width: 480,
        height: 300,
      },
      createElement(ChartView, {
        chart: read,
        x: 0,
        y: 0,
        width: 4_800_000,
        height: 3_000_000,
        theme: undefined,
        context,
      }),
    ),
  )

  await writeFile(join(out, `${name}.svg`), `${svg}\n`)
  index.push(`<figure><img src="${name}.svg" width="420"><figcaption>${name}</figcaption></figure>`)
  drawn += 1
}

await writeFile(join(out, 'index.html'), `${index.join('\n')}\n`)

console.log(
  `${String(drawn)} charts drawn and ${String(framed)} framed into ${out}; open ${join(out, 'index.html')} to look at them beside the originals.`,
)
