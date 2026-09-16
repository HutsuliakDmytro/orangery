import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Document outline: the heading structure, for the navigation sidebar.
 *
 * Built from the document rather than from a table of contents field, so it is
 * always current — a TOC in the file may be stale, and Word's is only updated
 * when the user asks.
 */

export interface OutlineEntry {
  /** Document position, for scrolling to the heading. */
  position: number
  level: number
  text: string
  /** Nesting depth for display, which is not the same as the heading level:
   *  a document that starts at Heading 2 should not be indented by one. */
  depth: number
}

export function buildOutline(doc: ProseMirrorNode): OutlineEntry[] {
  const headings: { position: number; level: number; text: string }[] = []

  doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return true

    const level: unknown = node.attrs['level']
    headings.push({
      position,
      level: typeof level === 'number' ? level : 1,
      text: node.textContent.trim(),
    })
    return false
  })

  return withDepths(headings)
}

/**
 * Converts heading levels to display depths by tracking the levels seen so far,
 * so a document using H2/H4 renders as two tiers rather than one and three.
 */
function withDepths(
  headings: readonly { position: number; level: number; text: string }[],
): OutlineEntry[] {
  const stack: number[] = []

  return headings.map((heading) => {
    while (stack.length > 0 && (stack[stack.length - 1] ?? 0) >= heading.level) stack.pop()
    stack.push(heading.level)

    return { ...heading, depth: stack.length - 1 }
  })
}
