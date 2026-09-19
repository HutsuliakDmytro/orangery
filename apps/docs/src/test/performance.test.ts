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
 * Why these two may be retried.
 *
 * They measure wall-clock time on a machine running the whole workspace's
 * tests at once, and every so often a run lands beside something that eats the
 * processor for a second. A retry costs a few seconds and buys a suite people
 * still believe; a failure that means "another package was busy" is the kind
 * that teaches everybody to ignore a red build. What a retry cannot hide is a
 * real regression — that fails every time, because it is in the code rather
 * than in the weather.
 */

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

/**
 * The cheapest of several runs.
 *
 * Not the median, which is the obvious choice and the wrong one here: noise
 * only ever adds time, so the fastest run is the one that was interrupted
 * least, and it is the closest thing to the work's real cost. The median holds
 * up when the odd run is unlucky; it does not when every run allocates half a
 * million strings and the whole suite is competing for the same heap, which is
 * how counting a document's words behaves on a loaded machine.
 *
 * A regression shows in the minimum as surely as in the median — a pass over
 * the document that should not be there is in every run, fast or slow.
 */
function fastest(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values)
}

/** The cheapest of several runs, so a GC pause does not decide the test. */
function timeOf(work: () => unknown, iterations = MEASURE_ITERATIONS): number {
  const samples: number[] = []

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now()
    work()
    samples.push(performance.now() - start)
  }

  return fastest(samples)
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

  return { small: fastest(smalls), large: fastest(larges) }
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

  it('builds the outline of a 200-page document in step with its size', { retry: 2 }, () => {
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

  /**
   * Counting words is measured against half of itself rather than against a
   * tenth.
   *
   * A tenth of this work takes about six milliseconds, and six milliseconds on
   * a machine running a dozen test workers is mostly scheduling: the small
   * measurement barely moves under load while the large one triples, and the
   * ratio between them says more about the machine than about the code. Two
   * sizes of the same order are slowed by the same amount, so the load
   * cancels and what is left is the shape of the curve.
   *
   * Half the pages should cost half the time. Twice that is room for a busy
   * machine; a pass over the document hiding inside the per-word work would
   * show as four.
   */
  it('counts words of a 200-page document in step with its size', { retry: 2 }, () => {
    editor = createTestEditor('<p></p>')

    editor.commands.setContent(buildLargeDocument(100))
    const halfText = editor.getText({ blockSeparator: '\n' })
    editor.commands.setContent(buildLargeDocument(200))
    const wholeText = editor.getText({ blockSeparator: '\n' })

    const { small: half, large: whole } = ratioOf(
      () => computeStatistics(halfText),
      () => computeStatistics(wholeText),
    )

    expect(computeStatistics(wholeText).words).toBeGreaterThan(90_000)
    expect(whole).toBeLessThan(Math.max(half * 4, NOISE_FLOOR_MS))
  })
})
