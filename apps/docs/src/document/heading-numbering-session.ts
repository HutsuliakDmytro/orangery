import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  getPartText,
  parseXml,
  serializeNode,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { NUMBERING_PART, STYLES_PART } from '../ooxml/parts'
import {
  buildHeadingAbstractNum,
  HEADING_STYLE_IDS,
  isHeadingAbstractNum,
  schemeOf,
  withHeadingNumbering,
} from '../ooxml/heading-numbering'
import { buildNum } from '../ooxml/numbering-builder'
import type { HeadingNumberScheme } from '../editor/heading-numbers'

/**
 * Numbering the heading styles of the open package.
 *
 * One definition serves the whole document, so turning numbering on twice must
 * reuse the definition already there rather than leave a trail of unused ones.
 * It is recognised by the name written into it — the user's own document may
 * have brought numbering of its own, and that is not ours to replace.
 */

const NUMBERING_ROOT = 'w:numbering'

function numberingRoots(pkg: OoxmlPackage): XmlNode[] {
  const existing = getPartText(pkg, NUMBERING_PART)
  if (existing !== undefined) return parseXml(existing)

  return [
    element(NUMBERING_ROOT, {
      'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    }),
  ]
}

/** The children array of `w:numbering`, created when the part is new. */
function listOf(root: XmlNode): XmlNode[] {
  const list: unknown = root[NUMBERING_ROOT]
  if (Array.isArray(list)) return list as XmlNode[]

  const created: XmlNode[] = []
  ;(root as Record<string, unknown>)[NUMBERING_ROOT] = created
  return created
}

/** Reads back what the file says about numbered headings, if anything. */
export function readHeadingNumbering(pkg: OoxmlPackage): HeadingNumberScheme | null {
  const styles = getPartText(pkg, STYLES_PART)
  const numbering = getPartText(pkg, NUMBERING_PART)
  if (styles === undefined || numbering === undefined) return null

  // The style has to point at the definition, and the definition has to exist.
  // A `w:numPr` naming a numId the file does not define is what Word shows as
  // an unnumbered heading, so it is read the same way here.
  const numId = headingNumId(styles)
  if (numId === null) return null

  const root = parseXml(numbering).find((node) => tagName(node) === NUMBERING_ROOT)
  if (!root) return null

  const instance = children(root).find(
    (node) => tagName(node) === 'w:num' && attribute(node, 'w:numId') === String(numId),
  )
  const abstractId =
    instance === undefined
      ? undefined
      : attribute(findChild(instance, 'w:abstractNumId') ?? {}, 'w:val')

  const abstract = children(root).find(
    (node) =>
      tagName(node) === 'w:abstractNum' && attribute(node, 'w:abstractNumId') === abstractId,
  )

  return abstract === undefined ? null : schemeOf(abstract)
}

/** The numId the first numbered heading style points at. */
function headingNumId(stylesXml: string): number | null {
  const root = parseXml(stylesXml).find((node) => tagName(node) === 'w:styles')
  if (!root) return null

  for (const style of children(root)) {
    if (tagName(style) !== 'w:style') continue
    if (!HEADING_STYLE_IDS.includes(attribute(style, 'w:styleId') ?? '')) continue

    const numPr = findChild(style, 'w:pPr')
    const numbering = numPr === undefined ? undefined : findChild(numPr, 'w:numPr')
    const numId = numbering === undefined ? undefined : findChild(numbering, 'w:numId')
    const value = numId === undefined ? undefined : attribute(numId, 'w:val')

    if (value !== undefined) {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }

  return null
}

/**
 * Writes the scheme into the package, or takes the numbering off.
 *
 * Returns whether `numbering.xml` had to be created, which the caller needs in
 * order to add the relationship and content-type declaration that a new part
 * cannot open without.
 */
export function writeHeadingNumbering(
  pkg: OoxmlPackage,
  scheme: HeadingNumberScheme | null,
): { createdNumberingPart: boolean } {
  const styles = getPartText(pkg, STYLES_PART)
  if (styles === undefined) return { createdNumberingPart: false }

  if (scheme === null) {
    setPartText(pkg, STYLES_PART, applyToHeadingStyles(styles, null))
    return { createdNumberingPart: false }
  }

  const hadPart = getPartText(pkg, NUMBERING_PART) !== undefined
  const roots = numberingRoots(pkg)
  const root = roots.find((node) => tagName(node) === NUMBERING_ROOT)
  if (!root) return { createdNumberingPart: false }

  const list = listOf(root)
  const ours = list.find((node) => tagName(node) === 'w:abstractNum' && isHeadingAbstractNum(node))

  const abstractId =
    ours === undefined
      ? freeId(list, 'w:abstractNum', 'w:abstractNumId', 0)
      : idOf(ours, 'w:abstractNumId')

  const definition = buildHeadingAbstractNum(abstractId, scheme)

  if (ours === undefined) {
    // Every `w:abstractNum` must precede every `w:num`, so the definition goes
    // in front of the instances rather than at the end.
    const firstNum = list.findIndex((node) => tagName(node) === 'w:num')
    list.splice(firstNum === -1 ? list.length : firstNum, 0, definition)
  } else {
    list.splice(list.indexOf(ours), 1, definition)
  }

  const instance = list.find(
    (node) =>
      tagName(node) === 'w:num' &&
      attribute(findChild(node, 'w:abstractNumId') ?? {}, 'w:val') === String(abstractId),
  )

  const numId =
    instance === undefined ? freeId(list, 'w:num', 'w:numId', 1) : idOf(instance, 'w:numId')
  if (instance === undefined) list.push(buildNum(numId, abstractId))

  setPartText(pkg, NUMBERING_PART, withDeclaration(buildXml(roots)))
  setPartText(pkg, STYLES_PART, applyToHeadingStyles(styles, numId))

  return { createdNumberingPart: !hadPart }
}

function idOf(node: XmlNode, name: string): number {
  const parsed = Number.parseInt(attribute(node, name) ?? '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function freeId(list: readonly XmlNode[], tag: string, name: string, from: number): number {
  const taken = new Set(
    list.filter((node) => tagName(node) === tag).map((node) => attribute(node, name)),
  )

  let candidate = from
  while (taken.has(String(candidate))) candidate += 1
  return candidate
}

/** Puts the numbering on every heading style the file declares, or takes it off. */
function applyToHeadingStyles(stylesXml: string, numId: number | null): string {
  const roots = parseXml(stylesXml)
  const root = roots.find((node) => tagName(node) === 'w:styles')
  if (!root) return stylesXml

  const list = root['w:styles']
  if (!Array.isArray(list)) return stylesXml

  for (let index = 0; index < list.length; index += 1) {
    const style = list[index] as XmlNode
    if (tagName(style) !== 'w:style') continue

    const level = HEADING_STYLE_IDS.indexOf(attribute(style, 'w:styleId') ?? '')
    if (level === -1) continue

    const rebuilt = withHeadingNumbering(serializeNode(style), numId, level)
    list[index] = parseXml(rebuilt)[0] as XmlNode
  }

  return withDeclaration(buildXml(roots))
}
