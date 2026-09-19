/**
 * Every preset geometry on one page, to look at.
 *
 * The paths are property-tested — they parse, they scale, they stay in their
 * box — and none of that can tell a house from a bird. A preset table is one of
 * the few things in this app where the only check that means anything is a
 * person looking at it, and this is what there is to look at: the whole of
 * `ST_ShapeType`, drawn at one size, named.
 *
 * It caught two things the tests could not: four corner marks of which three
 * were drawn outside the box, and a question mark that came out as a bird.
 *
 * Usage: pnpm shapes [name,name,…] [--out path.png]
 */

import { chromium } from '@playwright/test'
import { isLinePreset, pathFor, PRESET_NAMES } from '../src/render/geometry'

const argv = process.argv.slice(2)
const outAt = argv.indexOf('--out')
const out = outAt === -1 ? 'test-results/shape-sheet.png' : (argv[outAt + 1] ?? '')
const wanted =
  argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0].split(',') : PRESET_NAMES

const cells = wanted
  .map((name) => {
    const d = pathFor(name, { width: 100, height: 75 })
    const paint = isLinePreset(name)
      ? 'fill="none" stroke="#111" stroke-width="3"'
      : 'fill="#e8a33d" stroke="#111" stroke-width="1.5"'

    return `<figure><svg viewBox="-6 -6 112 87" width="130" height="100"><path d="${d}" ${paint}/></svg><figcaption>${name}</figcaption></figure>`
  })
  .join('')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 840, height: 600 } })

await page.setContent(
  `<html><body style="background:#fff;font:11px sans-serif;margin:0">` +
    `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px">${cells}</div>` +
    `<style>figure{margin:0;text-align:center}</style></body></html>`,
)
await page.screenshot({ path: out, fullPage: true })
await browser.close()

console.log(`${String(wanted.length)} shapes → ${out}`)
