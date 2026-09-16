import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { comparePages, corpusFiles, DEFAULT_THRESHOLD } from './render-diff'

/**
 * The LibreOffice and poppler steps only run in CI, where those tools exist.
 * The comparison logic is ours, so it is tested here.
 */

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'render-diff-test-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

async function page(
  name: string,
  paint: (png: PNG) => void,
  size = { width: 40, height: 40 },
): Promise<string> {
  const png = new PNG(size)
  png.data.fill(255)
  paint(png)

  const path = join(workspace, name)
  await writeFile(path, PNG.sync.write(png))
  return path
}

const blank = () => {
  /* left white */
}

function paintPixels(count: number) {
  return (png: PNG) => {
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4
      png.data[offset] = 0
      png.data[offset + 1] = 0
      png.data[offset + 2] = 0
    }
  }
}

describe('comparePages', () => {
  it('passes when the pages are identical', async () => {
    const before = await page('a.png', paintPixels(50))
    const after = await page('b.png', paintPixels(50))

    expect(await comparePages([before], [after], 'test', DEFAULT_THRESHOLD)).toEqual({ ok: true })
  })

  it('fails when the page count changed', async () => {
    const single = await page('a.png', blank)
    const result = await comparePages([single], [single, single], 'test', DEFAULT_THRESHOLD)

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('page count changed')
  })

  it('fails when a page changed size', async () => {
    const before = await page('a.png', blank, { width: 40, height: 40 })
    const after = await page('b.png', blank, { width: 40, height: 50 })

    const result = await comparePages([before], [after], 'test', DEFAULT_THRESHOLD)
    expect(result.detail).toContain('changed size')
  })

  it('fails when too many pixels differ', async () => {
    const before = await page('a.png', blank)
    // 40×40 = 1600 pixels; 200 black ones is 12.5%, far over the threshold.
    const after = await page('b.png', paintPixels(200))

    const result = await comparePages([before], [after], 'test', DEFAULT_THRESHOLD)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('% of pixels differ')
  })

  it('tolerates a difference under the threshold', async () => {
    const before = await page('a.png', blank)
    const after = await page('b.png', paintPixels(1))

    // One pixel in 1600 is 0.0625%, which a 1% threshold should let through.
    expect((await comparePages([before], [after], 'test', 0.01)).ok).toBe(true)
  })

  it('compares every page, not just the first', async () => {
    const clean = await page('a.png', blank)
    const dirty = await page('b.png', paintPixels(400))

    const result = await comparePages([clean, clean], [clean, dirty], 'test', DEFAULT_THRESHOLD)
    expect(result.detail).toContain('page 2')
  })
})

describe('corpusFiles', () => {
  it('finds the corpus the round-trip tests use', async () => {
    const files = await corpusFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((file) => file.path.endsWith('.docx'))).toBe(true)
  })

  it('skips Word lock files', async () => {
    const files = await corpusFiles()
    expect(files.some((file) => file.label.includes('~$'))).toBe(false)
  })
})
