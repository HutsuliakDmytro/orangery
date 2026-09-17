import { ATTRIBUTE_PREFIX, attribute, children, tagName } from './xml'
import type { XmlNode } from './xml'

/**
 * Changing XML in place.
 *
 * The preservation guarantee rests on editing the tree that was parsed rather
 * than building a new one: everything not touched here keeps its position, its
 * attributes and its children, including the parts nothing in this codebase
 * understands.
 *
 * These mutate. That is deliberate and it is the point — a copy would leave the
 * original in the package and the edit nowhere.
 */

/** Sets an attribute, adding the bag if the element had none. */
export function setAttribute(node: XmlNode, name: string, value: string): void {
  const key = `${ATTRIBUTE_PREFIX}${name}`
  const existing = node[':@']

  if (typeof existing === 'object' && existing !== null) {
    ;(existing as Record<string, string>)[key] = value
    return
  }

  node[':@'] = { [key]: value }
}

export function removeAttribute(node: XmlNode, name: string): void {
  const bag = node[':@']
  if (typeof bag !== 'object' || bag === null) return

  // Rebuilt rather than deleted from: attribute order is output order, and
  // keeping the survivors in their order keeps the file's diff to one change.
  const key = `${ATTRIBUTE_PREFIX}${name}`
  const kept = Object.fromEntries(
    Object.entries(bag as Record<string, string>).filter(([name]) => name !== key),
  )

  if (Object.keys(kept).length === 0) {
    node[':@'] = {}
    return
  }
  node[':@'] = kept
}

/**
 * Where a new child belongs among the ones already there.
 *
 * OOXML sequences are ordered, and an element in the wrong place is not a
 * cosmetic difference: Word and PowerPoint both offer to repair a file whose
 * `a:spPr` has its fill before its geometry. `order` is the schema's sequence;
 * anything not in it is left where it is and never jumped over.
 */
function insertionPoint(
  siblings: readonly XmlNode[],
  tag: string,
  order: readonly string[],
): number {
  const position = order.indexOf(tag)
  if (position === -1) return siblings.length

  const index = siblings.findIndex((sibling) => {
    const at = order.indexOf(tagName(sibling) ?? '')
    return at !== -1 && at > position
  })

  return index === -1 ? siblings.length : index
}

/**
 * Replaces the first child with this tag, or inserts one in schema order.
 *
 * Replacing rather than removing and appending: an element that was third stays
 * third, so a diff of the saved file shows the one thing that changed.
 */
export function upsertChild(node: XmlNode, child: XmlNode, order: readonly string[]): void {
  const tag = tagName(node)
  const childTag = tagName(child)
  if (tag === null || childTag === null) return

  const siblings = children(node)
  const existing = siblings.findIndex((sibling) => tagName(sibling) === childTag)

  if (existing !== -1) {
    siblings[existing] = child
    return
  }

  siblings.splice(insertionPoint(siblings, childTag, order), 0, child)
}

/** Removes every child with this tag. Does nothing when there are none. */
export function removeChild(node: XmlNode, tag: string): void {
  const siblings = children(node)

  for (let index = siblings.length - 1; index >= 0; index -= 1) {
    if (tagName(siblings[index] ?? {}) === tag) siblings.splice(index, 1)
  }
}

/**
 * The child with this tag, creating it in schema order when absent.
 *
 * For properties that live on an element that may not exist yet — a transform
 * inside shape properties that state only a geometry.
 */
export function ensureChild(node: XmlNode, tag: string, order: readonly string[]): XmlNode {
  const existing = children(node).find((child) => tagName(child) === tag)
  if (existing !== undefined) return existing

  const created: XmlNode = { [tag]: [] }
  upsertChild(node, created, order)
  return created
}

/** True when the element has this attribute, whatever its value. */
export function hasAttribute(node: XmlNode, name: string): boolean {
  return attribute(node, name) !== undefined
}
