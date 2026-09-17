import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { computeStatistics } from '../editor/statistics'
import { buildOutline } from '../editor/outline'
import { approximateWordCount, buildLargeDocument } from './large-document'
import { createTestEditor } from './editor-harness'

/**
 * Performance budget for a 200-page document (CLAUDE.md: "Large docs must stay
 * responsive").
 *
 * The failure worth catching is work that grows faster than the document —
 * a pass over every paragraph on each keystroke, a scan inside a loop. That
 * shows up as seconds, not as a few milliseconds.
 *
 * Which is why the derived views are measured against the same work on a
 * tenth of the document rather than against a wall-clock ceiling. A shared CI
 * runner with the rest of the suite on it is an order of magnitude slower than
 * a laptop — an absolute budget there either fails on a healthy build or is so
 * loose it would sleep through a real regression. A ratio moves with the
 * machine; only the shape of the curve has to hold.
 */

const TYPING_BUDGET_MS = 50
const MEASURE_ITERATIONS = 20

/**
 * What a ten-fold document may cost relative to a tenth of it.
 *
 * Both views measure at almost exactly ten on a healthy build, so this is
 * double the real figure: room for a loaded runner without room for a pass
 * over the document hiding inside the per-word work.
 */
const GROWTH_ALLOWANCE = 20

/**
 * The allowance never drops under this. Building the outline of a tenth of the
 * document is tens of microseconds, and twenty times almost nothing is still
 * almost nothing — a bound that thin would fail on scheduling jitter alone.
 * The floor only ever widens the bound, so it cannot make the test flaky; it
 * costs detection on the cheapest view, where a regression has to be gross to
 * matter anyway.
 */
const NOISE_FLOOR_MS = 10

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Median of several runs, so one unlucky GC pause does not decide the test. */
function timeOf(work: () => unknown, iterations = MEASURE_ITERATIONS): number {
  const samples: number[] = []

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now()
    work()
    samples.push(performance.now() - start)
  }

  return median(samples)
}

/**
 * Times two pieces of work against each other, alternating between them.
 *
 * Measuring one and then the other compares two different moments. That is
 * fine on an idle machine and wrong on a busy one: this suite runs seven
 * projects at once, and whichever half is measured while the machine is loaded
 * comes out slower for reasons that have nothing to do with the code. Taking
 * the samples in turn means a stall lands on both.
 */
function ratioOf(small: () => unknown, large: () => unknown, iterations = MEASURE_ITERATIONS) {
  const smalls: number[] = []
  const larges: number[] = []

  for (let index = 0; index < iterations; index += 1) {
    const beforeSmall = performance.now()
    small()
    smalls.push(performance.now() - beforeSmall)

    const beforeLarge = performance.now()
    large()
    larges.push(performance.now() - beforeLarge)
  }

  return { small: median(smalls), large: median(larges) }
}

function timeTyping(instance: Editor, iterations = MEASURE_ITERATIONS): number {
  return timeOf(() => instance.commands.insertContentAt(1, 'x'), iterations)
}

describe('large document', () => {
  it('builds a corpus of roughly the right size', () => {
    const doc = buildLargeDocument(200)
    expect(approximateWordCount(doc)).toBeGreaterThan(90_000)
  })

  it('loads a 200-page document', () => {
    editor = createTestEditor('<p></p>')
    editor.commands.setContent(buildLargeDocument(200))

    expect(editor.state.doc.content.childCount).toBe(200 * 6)
  })

  it('keeps a keystroke under the budget', () => {
    editor = createTestEditor('<p></p>')
    editor.commands.setContent(buildLargeDocument(200))

    expect(timeTyping(editor)).toBeLessThan(TYPING_BUDGET_MS)
  })

  it('does not slow down markedly as the document grows', () => {
    editor = createTestEditor('<p></p>')

    editor.commands.setContent(buildLargeDocument(20))
    const small = timeTyping(editor)

    editor.commands.setContent(buildLargeDocument(200))
    const large = timeTyping(editor)

    // Typing cost should be close to flat: a ten-fold document should not make
    // a keystroke ten times more expensive.
    expect(large).toBeLessThan(Math.max(small * 4, TYPING_BUDGET_MS))
  })
})

describe('derived views', () => {
  /** What a ten-fold document is allowed to cost, on this machine, today. */
  const allowanceFrom = (small: number) => Math.max(small * GROWTH_ALLOWANCE, NOISE_FLOOR_MS)

  it('builds the outline of a 200-page document in step with its size', () => {
    editor = createTestEditor('<p></p>')

    // ProseMirror documents are immutable, so the small one survives being
    // replaced in the editor and can still be measured against.
    editor.commands.setContent(buildLargeDocument(20))
    const smallDoc = editor.state.doc
    editor.commands.setContent(buildLargeDocument(200))
    const largeDoc = editor.state.doc

    const { small, large } = ratioOf(
      () => buildOutline(smallDoc),
      () => buildOutline(largeDoc),
    )

    expect(buildOutline(largeDoc)).toHaveLength(200)
    expect(large).toBeLessThan(allowanceFrom(small))
  })

  it('counts words of a 200-page document in step with its size', () => {
    editor = createTestEditor('<p></p>')

    editor.commands.setContent(buildLargeDocument(20))
    const smallText = editor.getText({ blockSeparator: '\n' })
    editor.commands.setContent(buildLargeDocument(200))
    const largeText = editor.getText({ blockSeparator: '\n' })

    const { small, large } = ratioOf(
      () => computeStatistics(smallText),
      () => computeStatistics(largeText),
    )

    expect(computeStatistics(largeText).words).toBeGreaterThan(90_000)
    expect(large).toBeLessThan(allowanceFrom(small))
  })
})
