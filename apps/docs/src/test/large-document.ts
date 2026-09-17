import type { ProseMirrorNodeJson } from '../ooxml/prosemirror-json'

/**
 * A document big enough to expose per-keystroke work that scales with size.
 *
 * Roughly 500 words per page (the same figure the status bar estimates with),
 * so 200 pages is about 100 000 words — a long thesis, which is the case
 * CLAUDE.md sets as the performance budget.
 */

const SENTENCE =
  'The quick brown fox jumps over the lazy dog while the committee reviews the quarterly findings. '

export function buildLargeDocument(pages = 200): ProseMirrorNodeJson {
  const content: ProseMirrorNodeJson[] = []

  for (let page = 0; page < pages; page += 1) {
    content.push({
      type: 'heading',
      attrs: { level: (page % 3) + 1 },
      content: [{ type: 'text', text: `Section ${String(page + 1)}` }],
    })

    // Five paragraphs of roughly a hundred words each.
    for (let index = 0; index < 5; index += 1) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: SENTENCE.repeat(6).trim() }],
      })
    }
  }

  return { type: 'doc', content }
}

export function approximateWordCount(doc: ProseMirrorNodeJson): number {
  const text = (node: ProseMirrorNodeJson): string =>
    node.text ?? (node.content ?? []).map(text).join(' ')
  return text(doc).split(/\s+/u).filter(Boolean).length
}
