import { ATTRIBUTE_PREFIX, buildXml, isTextNode, tagName, XML_DECLARATION } from './xml'
import type { XmlNode } from './xml'
import { getPartText, setPartText } from './package'
import type { OoxmlPackage } from './package'

/**
 * Writing a part back without losing what nobody parsed.
 *
 * Every writer in the suite regenerates a part from a model, and a model holds
 * what somebody thought to put in it. What the file also had — the declaration
 * it was written with, the fifteen namespaces its root declared, the element
 * before the body that nothing reads — is not in the model and so is not in
 * what comes out. That is one bug with many faces:
 *
 * - `word/footnotes.xml` came back with five of its namespace declarations
 *   gone, so a footnote holding VML or an equation would have been written as
 *   XML with an undeclared prefix — a file Word refuses to open;
 * - every regenerated part came back with `encoding="utf-8"` rewritten as
 *   `UTF-8` and `standalone="yes"` added, in 45 files of the corpus;
 * - `w:background`, the page colour, was dropped from 34 documents, because
 *   the serialiser writes `w:document` as a root with a body in it and the
 *   background is the root's other child.
 *
 * So this is the rule, in one place: **a part that already exists keeps its
 * own declaration and its own root attributes, and only its content is
 * regenerated.** What the writer states wins over what the file stated —
 * setting an attribute deliberately is the one case where the old value is
 * not wanted — and everything the writer said nothing about survives.
 */

/** The first element of a part, as text: its tag and its attributes. */
const ROOT_TAG = /<([\w:.-]+)((?:\s[^>]*?)?)\s*\/?>/u

/** Attributes inside a start tag, which is not a job worth a parser. */
const ATTRIBUTE = /([:\w.-]+)\s*=\s*"([^"]*)"/gu

/**
 * The XML declaration the part was written with, or none.
 *
 * Not normalised to ours. Word writes double quotes and a CRLF, python-pptx
 * writes single quotes and a newline, LibreOffice writes `utf-8` in lower
 * case, and a part we did not otherwise change must come back as it was.
 */
export function declarationOf(text: string | undefined): string {
  return /^\s*<\?xml[^?]*\?>\r?\n?/u.exec(text ?? '')?.[0] ?? ''
}

/**
 * The attributes on a part's root element.
 *
 * Read with a regular expression rather than a parse: `word/document.xml` is
 * the largest part of a document and this runs on every save, and the answer
 * is in its first two hundred bytes.
 */
export function rootAttributesOf(text: string | undefined): Record<string, string> {
  const body = (text ?? '').replace(/^\s*<\?xml[^?]*\?>/u, '').replace(/<!--[\s\S]*?-->/gu, '')
  const found = ROOT_TAG.exec(body)
  if (found === null) return {}

  const result: Record<string, string> = {}
  for (const match of (found[2] ?? '').matchAll(ATTRIBUTE)) {
    const [, name, value] = match
    if (name !== undefined && value !== undefined) result[name] = value
  }
  return result
}

/** The same node with `extra` underneath the attributes it already states. */
function beneath(node: XmlNode, extra: Record<string, string>): XmlNode {
  const own = (node[':@'] ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(extra)) merged[`${ATTRIBUTE_PREFIX}${name}`] = value
  for (const [name, value] of Object.entries(own)) merged[name] = value

  return { ...node, ':@': merged }
}

/**
 * Serialises a rebuilt part, keeping what the old one said about itself.
 *
 * `previous` is the part as it was read, or undefined for a part that did not
 * exist — in which case this is `withDeclaration(buildXml(roots))` and nothing
 * more.
 */
export function preservingRoot(previous: string | undefined, roots: XmlNode[]): string {
  const declaration = declarationOf(previous) || XML_DECLARATION
  const was = rootAttributesOf(previous)

  if (Object.keys(was).length === 0) return `${declaration}${buildXml(roots)}`

  const index = roots.findIndex((node) => !isTextNode(node))
  const root = roots[index]
  if (root === undefined) return `${declaration}${buildXml(roots)}`

  // Only when it is the same element: a part rebuilt into a different root is
  // a different part, and its attributes are not this one's.
  const rootTag = tagName(root)
  const wasTag = ROOT_TAG.exec((previous ?? '').replace(/^\s*<\?xml[^?]*\?>/u, ''))?.[1]
  if (rootTag === null || rootTag !== wasTag) return `${declaration}${buildXml(roots)}`

  const kept = [...roots]
  kept[index] = beneath(root, was)

  return `${declaration}${buildXml(kept)}`
}

/**
 * Replaces a part's XML, keeping its declaration and its root attributes.
 *
 * The form to reach for: the package has the old text, so nothing has to be
 * threaded through the writer to keep it.
 */
export function setPartXml(pkg: OoxmlPackage, path: string, roots: XmlNode[]): void {
  setPartText(pkg, path, preservingRoot(getPartText(pkg, path), roots))
}
