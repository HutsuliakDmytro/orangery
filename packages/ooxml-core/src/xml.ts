// fast-xml-parser deprecated its own builder; the split package is the
// supported one and produces byte-identical output for our option set.
import XmlBuilder from 'fast-xml-builder'
import { XMLParser } from 'fast-xml-parser'
import { OoxmlFormatError } from './package'

/**
 * XML parsing tuned for round-trip fidelity.
 *
 * `preserveOrder` keeps sibling order and repeated elements, which OOXML relies
 * on heavily — `w:p` children are a sequence, not a set. Values are never coerced
 * to numbers or booleans: `w:val="0"` and `w:val="false"` are distinct strings to
 * Word, and normalising them changes the file.
 */

export const ATTRIBUTE_PREFIX = '@_'
export const TEXT_KEY = '#text'

const sharedOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  textNodeName: TEXT_KEY,
  preserveOrder: true,
  // OOXML is whitespace-significant inside `w:t` when `xml:space="preserve"`.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
} as const

const parser = new XMLParser({
  ...sharedOptions,
  processEntities: true,
})

/**
 * `entities` is supported by the builder but missing from its published types,
 * so the option set is described here rather than cast away.
 */
interface EntityRule {
  regex: RegExp
  val: string
}

type BuilderOptions = ConstructorParameters<typeof XmlBuilder>[0] & { entities: EntityRule[] }

const builderOptions: BuilderOptions = {
  ...sharedOptions,
  /**
   * The default set also escapes `'`. Word and Google Docs do not — and since an
   * apostrophe appears in most Ukrainian words, escaping it rewrites nearly
   * every run of text in a document that was otherwise untouched. `"` stays
   * escaped, because the writers we have fixtures from do escape it.
   *
   * `&` must come first, or the ampersands introduced by the later rules would
   * be escaped again.
   */
  entities: [
    { regex: /&/g, val: '&amp;' },
    { regex: /</g, val: '&lt;' },
    { regex: />/g, val: '&gt;' },
    { regex: /"/g, val: '&quot;' },
  ],
  format: false,
  suppressEmptyNode: true,
  processEntities: true,
}

const builder = new XmlBuilder(builderOptions)

/** One element in fast-xml-parser's `preserveOrder` representation. */
export type XmlNode = Record<string, unknown>

export function parseXml(xml: string): XmlNode[] {
  try {
    return parser.parse(xml) as XmlNode[]
  } catch (error) {
    // The parser's own refusals — a document nested five hundred deep, an
    // external entity pointing at `/etc/passwd` — are it defending itself
    // against a file built to break readers. Both are the right answer and
    // neither is a sentence anybody can act on, so they are given one.
    throw new OoxmlFormatError(
      `this part's XML cannot be read, and is probably not meant to be: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function buildXml(nodes: XmlNode[]): string {
  return builder.build(nodes)
}

/** The XML declaration Word writes. Kept byte-identical, including CRLF. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

/**
 * Puts a declaration in front of built XML, unless there is one already.
 *
 * `parseXml` hands the `<?xml?>` node back as a root like any other, so the
 * usual `withDeclaration(buildXml(parseXml(text)))` round trip has one in the
 * built string before this is called. Prepending regardless produced parts with
 * two prologs — not well-formed XML, which the readers here happen to tolerate
 * and PowerPoint does not. The one the file already carries is kept rather than
 * replaced: a part written with `standalone="no"` said so on purpose.
 *
 * The line break is put back because the parser drops it: every part in an
 * OOXML package has one, and a part that came back without it would be the one
 * file in the zip shaped differently for no reason.
 */
export function withDeclaration(xml: string): string {
  if (!xml.startsWith('<?xml')) return `${XML_DECLARATION}${xml}`

  return xml.replace(/^(<\?xml[^?]*\?>)(?!\r?\n)/u, '$1\r\n')
}

/** Strips a leading declaration so a part can be re-parsed after editing. */
export function stripDeclaration(xml: string): string {
  return xml.replace(/^\s*<\?xml[^?]*\?>\s*/u, '')
}

/** The tag name of a preserveOrder node, ignoring its attribute bag. */
export function tagName(node: XmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key === ':@') continue
    return key
  }
  return null
}

/** Children of a preserveOrder node, or an empty array for a leaf. */
export function children(node: XmlNode): XmlNode[] {
  const tag = tagName(node)
  if (tag === null) return []
  const value = node[tag]
  return Array.isArray(value) ? (value as XmlNode[]) : []
}

/** Attributes of a preserveOrder node, without the `@_` prefix. */
export function attributes(node: XmlNode): Record<string, string> {
  const raw = node[':@']
  if (typeof raw !== 'object' || raw === null) return {}

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.startsWith(ATTRIBUTE_PREFIX)) continue
    result[key.slice(ATTRIBUTE_PREFIX.length)] = String(value)
  }
  return result
}

export function attribute(node: XmlNode, name: string): string | undefined {
  return attributes(node)[name]
}

/** Builds a preserveOrder node. Attribute insertion order is the output order. */
export function element(
  tag: string,
  attrs: Record<string, string | undefined> = {},
  childNodes: XmlNode[] = [],
): XmlNode {
  const node: XmlNode = { [tag]: childNodes }

  const prefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    prefixed[`${ATTRIBUTE_PREFIX}${key}`] = value
  }
  if (Object.keys(prefixed).length > 0) node[':@'] = prefixed

  return node
}

/** A text node, as `preserveOrder` represents it. */
export function textNode(value: string): XmlNode {
  return { [TEXT_KEY]: value }
}

export function isTextNode(node: XmlNode): boolean {
  return TEXT_KEY in node
}

export function textValue(node: XmlNode): string {
  const value = node[TEXT_KEY]
  return typeof value === 'string' ? value : ''
}

/** First child with the given tag name, searching one level deep. */
export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return children(node).find((child) => tagName(child) === tag)
}

export function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return children(node).filter((child) => tagName(child) === tag)
}

/**
 * The first descendant with this tag, at any depth.
 *
 * Depth-first, because the markup that needs this nests the thing being looked
 * for inside two or three wrappers that carry nothing else — `a:blip` under a
 * graphic, for instance.
 */
export function findDescendant(node: XmlNode, tag: string): XmlNode | undefined {
  for (const child of children(node)) {
    if (tagName(child) === tag) return child
    const nested = findDescendant(child, tag)
    if (nested) return nested
  }
  return undefined
}

/** Serialises a single node back to XML, for storing as passthrough. */
export function serializeNode(node: XmlNode): string {
  return buildXml([node])
}

/** Parses a passthrough fragment back into a node. */
export function deserializeNode(xml: string): XmlNode | null {
  const parsed = parseXml(xml)
  return parsed[0] ?? null
}
