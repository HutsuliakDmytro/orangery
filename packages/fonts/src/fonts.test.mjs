import { strict as assert } from 'node:assert'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * A `@font-face` pointing at a file that is not there fails silently: the
 * browser falls back, the layout shifts, and nothing in the build complains.
 * These are the two guards worth having.
 */

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'fonts.css'), 'utf8')
const referenced = [...css.matchAll(/url\('\.\/files\/([^']+)'\)/gu)].map((match) => match[1])

test('every face points at a file that exists', () => {
  assert.ok(referenced.length > 0, 'no faces declared')

  for (const file of referenced) {
    assert.ok(existsSync(join(here, 'files', file)), `${file} is declared but not shipped`)
  }
})

test('every family ships its licence', () => {
  const licences = readdirSync(join(here, 'files')).filter((name) => name.endsWith('-LICENSE.txt'))

  for (const family of ['Inter', 'Liberation', 'Carlito', 'Caladea']) {
    assert.ok(
      licences.some((name) => name.startsWith(family)),
      `${family} ships without its licence`,
    )
  }
})

test('the metric-compatible families cover all four faces', () => {
  // A deck that asks for bold italic Calibri must not fall back mid-run.
  for (const stem of ['LiberationSans', 'LiberationSerif', 'Carlito', 'Caladea']) {
    for (const suffix of ['Regular', 'Italic', 'Bold', 'BoldItalic']) {
      assert.ok(referenced.includes(`${stem}-${suffix}.ttf`), `${stem}-${suffix} is not declared`)
    }
  }
})
