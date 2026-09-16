import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * Rebuilding nested lists from a flat sequence of items.
 *
 * Markdown and RTF both describe a list one item at a time, each carrying its
 * own depth — indentation in one, a level control word in the other — with
 * nothing to say where a list begins or ends. The nesting has to be inferred
 * from how the depth moves, which is the same job in both formats.
 *
 * Depth is only ever compared, never interpreted, so a caller can count in
 * whatever unit its format uses.
 */

export type ListKind = 'bulletList' | 'orderedList'

interface OpenList {
  depth: number
  kind: ListKind
  node: ProseMirrorNodeJson
  /** The array this list sits in, so a sibling list can join it. */
  siblings: ProseMirrorNodeJson[]
}

function itemsOf(list: ProseMirrorNodeJson): ProseMirrorNodeJson[] {
  if (list.content === undefined) list.content = []
  return list.content
}

/** The blocks of the last item, which is what a deeper list nests inside. */
function contentOfLastItem(list: ProseMirrorNodeJson): ProseMirrorNodeJson[] {
  const items = itemsOf(list)

  let last = items[items.length - 1]
  if (last === undefined) {
    last = { type: 'listItem', content: [] }
    items.push(last)
  }
  if (last.content === undefined) last.content = []

  return last.content
}

export interface ListBuilder {
  /**
   * Adds an item, opening and closing lists so that it lands at `depth`.
   *
   * `start` is the number a list counts from, and is only read from the item
   * that opens one.
   */
  addItem: (
    kind: ListKind,
    depth: number,
    blocks: ProseMirrorNodeJson[],
    start?: number,
  ) => void
  /** Ends every open list, so the next block is not swallowed into one. */
  close: () => void
}

export function listBuilder(content: ProseMirrorNodeJson[]): ListBuilder {
  // One entry per open nesting level, shallowest first.
  const open: OpenList[] = []

  const openIn = (siblings: ProseMirrorNodeJson[], kind: ListKind, depth: number): OpenList => {
    const node: ProseMirrorNodeJson = { type: kind, content: [] }
    siblings.push(node)

    const entry: OpenList = { depth, kind, node, siblings }
    open.push(entry)
    return entry
  }

  return {
    addItem(kind, depth, blocks, start) {
      // An item pulled back to the left ends every list deeper than it.
      while (open.length > 0 && depth < (open[open.length - 1]?.depth ?? 0)) open.pop()

      let current = open[open.length - 1]

      if (current !== undefined && current.depth === depth && current.kind !== kind) {
        // Same depth, different kind of list: a new one beside the old rather
        // than inside it.
        open.pop()
        current = openIn(current.siblings, kind, depth)
      } else if (current === undefined || depth > current.depth) {
        const siblings = current === undefined ? content : contentOfLastItem(current.node)
        current = openIn(siblings, kind, depth)
      }

      if (
        kind === 'orderedList' &&
        start !== undefined &&
        start > 1 &&
        itemsOf(current.node).length === 0
      ) {
        current.node.attrs = { start }
      }

      itemsOf(current.node).push({ type: 'listItem', content: blocks })
    },

    close() {
      open.length = 0
    },
  }
}
