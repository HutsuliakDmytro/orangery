import { attributes, children, isTextNode, parseXml, tagName, textValue } from './xml'
import type { XmlNode } from './xml'

/**
 * Structural XML comparison for round-trip tests.
 *
 * Byte equality is the wrong bar: Word itself varies `w:rsid*` revision-save ids
 * and attribute order between saves of an untouched file, so a byte diff reports
 * failures that Word would not consider differences. This compares the tree with
 * those normalised away, and reports the first real divergence with its path.
 */

/** Attributes Word regenerates and which carry no rendering meaning. */
const IGNORED_ATTRIBUTES =
  /^(w:rsid|w14:paraId|w14:textId|w:rsidR|w:rsidRPr|w:rsidRDefault|w:rsidP|w:rsidTr)/

export interface XmlDifference {
  path: string
  message: string
}

function significantAttributes(node: XmlNode): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(attributes(node))) {
    if (IGNORED_ATTRIBUTES.test(key)) continue
    result[key] = value
  }
  return result
}

/**
 * Property containers that carry no meaning when empty. `<w:pPr/>` states no
 * paragraph properties at all, which is what a paragraph without one states;
 * Word itself drops them on save. Writers differ on emitting them, so comparing
 * them would report a difference that changes nothing about the document.
 */
const EMPTY_IS_ABSENT = new Set(['w:pPr', 'w:rPr', 'w:tcPr', 'w:tblPr', 'w:trPr', 'w:sectPr'])

function isMeaningless(node: XmlNode): boolean {
  const tag = tagName(node)
  const elements = children(node).filter((child) => !isTextNode(child))

  if (tag !== null && EMPTY_IS_ABSENT.has(tag)) return elements.length === 0

  // A `w:r` whose only child is `w:rPr` states formatting for no content, and
  // renders nothing. Writers emit them as a side effect of editing history;
  // carrying an "empty run" through the document model to reproduce them would
  // add a concept with no meaning to the user.
  if (tag === 'w:r') return elements.every((child) => tagName(child) === 'w:rPr')

  return false
}

/** Drops empty text nodes, which serialisers differ on but Word ignores. */
function significantChildren(node: XmlNode): XmlNode[] {
  return children(node).filter(
    (child) => (!isTextNode(child) || textValue(child) !== '') && !isMeaningless(child),
  )
}

function compareNodes(
  left: XmlNode,
  right: XmlNode,
  path: string,
  differences: XmlDifference[],
): void {
  if (isTextNode(left) || isTextNode(right)) {
    if (textValue(left) !== textValue(right)) {
      differences.push({
        path,
        message: `text differs: ${JSON.stringify(textValue(left))} vs ${JSON.stringify(textValue(right))}`,
      })
    }
    return
  }

  const leftTag = tagName(left)
  const rightTag = tagName(right)
  if (leftTag !== rightTag) {
    differences.push({
      path,
      message: `element differs: <${leftTag ?? '?'}> vs <${rightTag ?? '?'}>`,
    })
    return
  }

  const here = `${path}/${leftTag ?? '?'}`

  const leftAttributes = significantAttributes(left)
  const rightAttributes = significantAttributes(right)
  const keys = new Set([...Object.keys(leftAttributes), ...Object.keys(rightAttributes)])

  for (const key of keys) {
    if (leftAttributes[key] !== rightAttributes[key]) {
      differences.push({
        path: here,
        message: `attribute ${key} differs: ${String(leftAttributes[key])} vs ${String(rightAttributes[key])}`,
      })
    }
  }

  const leftChildren = significantChildren(left)
  const rightChildren = significantChildren(right)

  if (leftChildren.length !== rightChildren.length) {
    differences.push({
      path: here,
      message: `child count differs: ${String(leftChildren.length)} vs ${String(rightChildren.length)}`,
    })
  }

  const count = Math.min(leftChildren.length, rightChildren.length)
  for (let index = 0; index < count; index += 1) {
    const leftChild = leftChildren[index]
    const rightChild = rightChildren[index]
    if (leftChild && rightChild)
      compareNodes(leftChild, rightChild, `${here}[${String(index)}]`, differences)
  }
}

export function compareXml(left: string, right: string): XmlDifference[] {
  const differences: XmlDifference[] = []
  const leftRoots = parseXml(left).filter((node) => !isTextNode(node))
  const rightRoots = parseXml(right).filter((node) => !isTextNode(node))

  if (leftRoots.length !== rightRoots.length) {
    differences.push({
      path: '/',
      message: `root count differs: ${String(leftRoots.length)} vs ${String(rightRoots.length)}`,
    })
  }

  const count = Math.min(leftRoots.length, rightRoots.length)
  for (let index = 0; index < count; index += 1) {
    const leftRoot = leftRoots[index]
    const rightRoot = rightRoots[index]
    if (leftRoot && rightRoot) compareNodes(leftRoot, rightRoot, '', differences)
  }

  return differences
}

export function describeDifferences(differences: XmlDifference[], limit = 5): string {
  if (differences.length === 0) return 'no differences'
  return differences
    .slice(0, limit)
    .map((difference) => `${difference.path}: ${difference.message}`)
    .join('\n')
}
