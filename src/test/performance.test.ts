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
 * The numbers are deliberately loose — CI machines vary — but they catch the
 * failure that matters: work that scales with document size running on every
 * keystroke. A regression there shows up as seconds, not as a few milliseconds.
 */

const TYPING_BUDGET_MS = 50
const MEASURE_ITERATIONS = 20

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function timeTyping(instance: Editor, iterations = MEASURE_ITERATIONS): number {
  const samples: number[] = []

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now()
    instance.commands.insertContentAt(1, 'x')
    samples.push(performance.now() - start)
  }

  return median(samples)
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
  it('builds the outline of a 200-page document quickly', () => {
    editor = createTestEditor('<p></p>')
    editor.commands.setContent(buildLargeDocument(200))

    const start = performance.now()
    const outline = buildOutline(editor.state.doc)
    const elapsed = performance.now() - start

    expect(outline).toHaveLength(200)
    expect(elapsed).toBeLessThan(200)
  })

  it('counts words of a 200-page document quickly', () => {
    editor = createTestEditor('<p></p>')
    editor.commands.setContent(buildLargeDocument(200))

    const start = performance.now()
    const stats = computeStatistics(editor.getText({ blockSeparator: '\n' }))
    const elapsed = performance.now() - start

    expect(stats.words).toBeGreaterThan(90_000)
    expect(elapsed).toBeLessThan(500)
  })
})
