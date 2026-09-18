import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDeck, readPptxPackage, readThemes, setAdvanceTime } from '@orangery/ooxml-presentation'
import type { Deck } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { exportVideo, holdsFor } from './export-video'

/**
 * The deck as a film.
 *
 * jsdom has neither a canvas that can be captured nor a recorder, so both are
 * stood in for. What is being tested is the part that is ours: how long each
 * slide is held, what happens to a slide that will not draw, and that stopping
 * keeps what was recorded rather than throwing it away.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const drawn: string[] = []
let held: number[] = []

class StubRecorder {
  state = 'recording'
  mimeType = 'video/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])]) })
    this.onstop?.()
  }
}

beforeEach(() => {
  drawn.length = 0
  held = []

  vi.stubGlobal('MediaRecorder', StubRecorder)

  // The clock is the thing being measured, so it is recorded rather than run.
  vi.stubGlobal('setTimeout', (run: () => void, delay?: number) => {
    held.push(delay ?? 0)
    run()
    return 0
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: () => undefined,
    drawImage: () => undefined,
  } as unknown as CanvasRenderingContext2D)

  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: () => ({ getTracks: () => [{ stop: () => undefined }] }),
  })

  // An image that never loads: what the engine does with a `foreignObject` is
  // a question about the engine, and the answer here is "nothing".
  Object.defineProperty(Image.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      drawn.push(value)
      setTimeout(() => {
        this.dispatchEvent(new Event('error'))
      }, 0)
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function open(name: string): Promise<{ deck: Deck; pkg: OoxmlPackage }> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  return { deck: readDeck(pkg), pkg }
}

const record = async (name: string, over: Record<string, unknown> = {}) => {
  const { deck, pkg } = await open(name)
  return exportVideo({ deck, themes: readThemes(pkg, deck), package: pkg, ...over })
}

describe('how long each slide is held', () => {
  it('uses the timing the deck states', async () => {
    const { deck } = await open('many-slides')
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    setAdvanceTime(first, 1500)
    expect(holdsFor(deck.slides)[0]).toBe(1500)
  })

  it('falls back where the slide waits for a press', async () => {
    // A film cannot wait for one, and a slide shown for no time is a slide
    // nobody saw.
    const { deck } = await open('many-slides')
    expect(holdsFor(deck.slides, 4000).every((hold) => hold === 4000)).toBe(true)
  })
})

describe('recording the deck', () => {
  it('holds every slide for its own time', async () => {
    const film = await record('many-slides')

    expect(film?.extension).toBe('webm')
    // Eight slides, eight holds; the stubbed clock kept every one of them.
    expect(held.filter((delay) => delay >= 1000)).toHaveLength(8)
  })

  it('says which slide it is on as it goes', async () => {
    const seen: number[] = []
    await record('many-slides', {
      onProgress: (at: number) => {
        seen.push(at)
      },
    })

    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('stops where it is asked to, keeping what it has', async () => {
    let at = 0
    const film = await record('many-slides', {
      onProgress: (index: number) => {
        at = index
      },
      cancelled: () => at >= 2,
    })

    // Somebody who stops at slide three of eight usually wants the three.
    expect(film?.bytes).not.toHaveLength(0)
    expect(held.filter((delay) => delay >= 1000).length).toBeLessThan(8)
  })

  it('draws a slide the engine will not rasterise rather than skipping it', async () => {
    // A film missing slide seven is worse than one where slide seven is blank,
    // because only one of the two is obvious.
    const film = await record('many-slides')

    expect(drawn).toHaveLength(8)
    expect(film).not.toBeNull()
  })

  it('answers nothing at all where the engine cannot record', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(await record('many-slides')).toBeNull()
  })
})
