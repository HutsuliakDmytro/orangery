import {
  attributes,
  buildXml,
  children,
  isTextNode,
  parseXml,
  resolveTarget,
  serializeNode,
  tagName,
  textValue,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * Indentation is not content.
 *
 * LibreOffice and several of POI's fixtures write their XML pretty-printed,
 * with a newline and some spaces between every pair of elements. Our writers
 * do not, and `compareXml` — which is right to keep whitespace, because
 * `<w:t xml:space="preserve"> </w:t>` is a space somebody typed — counts each
 * of those as a missing child. One pretty-printed sheet then reports two
 * hundred differences and hides the one that matters.
 *
 * So before comparing, whitespace-only text is dropped from any element that
 * also has element children. That is the XML notion of ignorable whitespace and
 * it cannot touch a text leaf: `w:t`, `a:t` and `t` hold text and nothing else,
 * so their whitespace always survives.
 */

const IGNORABLE = /^[\s\r\n]*$/

function strip(nodes: XmlNode[]): XmlNode[] {
  const kept: XmlNode[] = []

  for (const node of nodes) {
    if (isTextNode(node)) {
      kept.push(node)
      continue
    }

    const own = children(node)
    const hasElements = own.some((child) => !isTextNode(child))
    const next = hasElements
      ? strip(own.filter((child) => !isTextNode(child) || !IGNORABLE.test(textValue(child))))
      : own

    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key]) && key !== ':@') {
        kept.push({ ...node, [key]: next })
        break
      }
    }
  }

  return kept
}

/** The same XML with its formatting whitespace gone, ready to compare. */
export function withoutIndentation(xml: string): string {
  try {
    return buildXml(strip(parseXml(xml)))
  } catch {
    // A part we cannot parse is compared as it came; the comparison will say so.
    return xml
  }
}

/**
 * Elements both writers treat as theirs to regenerate.
 *
 * `w:proofErr` marks where the spell-checker stopped, and Word rewrites it on
 * every save from its own dictionary. `w:lastRenderedPageBreak` records where
 * the writer's layout engine broke a page and is meaningless to a different
 * one. Dropping them is a decision, not a loss — but leaving them in the
 * comparison costs more than the decision does: a paragraph that loses one
 * reports every later sibling as a mismatch, because the comparison walks
 * children by position.
 */
const REGENERATED = new Set(['w:proofErr', 'w:lastRenderedPageBreak'])

function withoutRegenerated(nodes: XmlNode[]): XmlNode[] {
  const kept: XmlNode[] = []

  for (const node of nodes) {
    if (isTextNode(node)) {
      kept.push(node)
      continue
    }

    const tag = tagName(node)
    if (tag !== null && REGENERATED.has(tag)) continue

    const own = children(node)
    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key]) && key !== ':@') {
        kept.push({ ...node, [key]: withoutRegenerated(own) })
        break
      }
    }
  }

  return kept
}

/**
 * Parts whose children are a set rather than a sequence.
 *
 * `[Content_Types].xml` and every `.rels` say what is in the package; the order
 * they say it in means nothing, and no reader depends on it. Comparing them by
 * position turns one removed part — `calcChain.xml`, which a workbook that was
 * edited no longer has — into a difference on every entry after it.
 */
const UNORDERED = /(^\[Content_Types\]\.xml$|\.rels$)/

function sortChildren(nodes: XmlNode[]): XmlNode[] {
  return nodes.map((node) => {
    if (isTextNode(node)) return node

    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key]) && key !== ':@') {
        const own = [...(node[key] as XmlNode[])].sort((a, b) =>
          serializeNode(a).localeCompare(serializeNode(b)),
        )
        return { ...node, [key]: own }
      }
    }

    return node
  })
}

/** The part a `.rels` file belongs to, which is what its targets are relative to. */
function ownerOf(relsPath: string): string {
  return relsPath.replace(/_rels\/([^/]+)\.rels$/, '$1')
}

/**
 * The manifest, with the parts that came or went taken out of it.
 *
 * A workbook that was edited is saved without `xl/calcChain.xml` — Excel
 * rebuilds it, and keeping a stale one is worse than keeping none. That is one
 * fact, and the part list reports it. Left in the manifests it becomes sixty:
 * the `[Content_Types].xml` entry, the relationship, and then every entry after
 * either of them, because the comparison counts children.
 *
 * So entries pointing at a part that is not in both packages are dropped from
 * both sides before comparing. What is left answers the question that is still
 * worth asking — whether the parts that *are* in both are declared the same way.
 */
function withoutChangedParts(path: string, nodes: XmlNode[], changed: Set<string>): XmlNode[] {
  if (changed.size === 0) return nodes

  const base = path.endsWith('.rels') ? ownerOf(path).replace(/[^/]+$/, '') : ''

  const points = (node: XmlNode): string | null => {
    const attribute = attributes(node)
    const partName = attribute['PartName']
    if (partName !== undefined) return partName.replace(/^\//, '')
    const target = attribute['Target']
    if (target !== undefined && attribute['TargetMode'] !== 'External')
      return resolveTarget(target, base)
    return null
  }

  return nodes.map((node) => {
    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key]) && key !== ':@') {
        const own = (node[key] as XmlNode[]).filter((child) => {
          const at = points(child)
          return at === null || !changed.has(at)
        })
        return { ...node, [key]: own }
      }
    }
    return node
  })
}

/**
 * A part as it should be compared: no indentation, nothing either side
 * regenerates, set-like parts in a fixed order, and no manifest entry for a
 * part that is not in both packages.
 */
export function comparable(path: string, xml: string, changed = new Set<string>()): string {
  try {
    const parsed = withoutRegenerated(strip(parseXml(xml)))
    if (!UNORDERED.test(path)) return buildXml(parsed)
    return buildXml(sortChildren(withoutChangedParts(path, parsed, changed)))
  } catch {
    return xml
  }
}
