import {
  attribute,
  attributes,
  children,
  element,
  findChild,
  isTextNode,
  parseXml,
  serializeNode,
  tagName,
  textValue,
} from './xml'
import type { XmlNode } from './xml'
import type { ProseMirrorMarkJson, ProseMirrorNodeJson } from './prosemirror-json'
import { resolveThemeFont } from './fonts'
import { imageNode, parseDrawing } from './image'
import { parseIntAttribute as parseInt2 } from './units'
import { listBuilder } from './list-nesting'
import { isBulletList } from './numbering'
import type { NumberingCatalogue } from './numbering'
import { parseTable } from './table'
import { parseTabs } from './tabs'
import type { TabStop } from './tabs'
import type { ThemeFonts } from './fonts'
import {
  halfPointsToPoints,
  lineUnitsToMultiplier,
  parseColor,
  parseIntAttribute,
  parseToggle,
  twipsToPoints,
} from './units'

/**
 * `word/document.xml` → ProseMirror JSON.
 *
 * Anything this parser does not recognise becomes a passthrough node carrying the
 * original XML, plus a warning. It must never throw on unknown input
 * (`docs/adr/0003-docx-native-roundtrip.md`).
 */

export interface ParseWarning {
  /** The OOXML element that could not be modelled. */
  tag: string
  message: string
}

export interface ParsedDocument {
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
  /** `w:sectPr` of the body, preserved verbatim for the serialiser. */
  sectionProperties: string | null
  /** Attributes of the `w:document` root, so namespaces survive. */
  documentAttributes: Record<string, string>
  /**
   * Whether the source put `xml:space="preserve"` on every `w:t`.
   *
   * There is no rule to infer here — it is a writer preference. Word adds it
   * when whitespace would otherwise be collapsed; Google Docs adds it to every
   * run. Matching the document's own convention is what keeps a file it wrote
   * byte-identical after a save.
   */
  alwaysPreserveSpace: boolean
}

export type { ProseMirrorMarkJson, ProseMirrorNodeJson } from './prosemirror-json'

type Mark = ProseMirrorMarkJson

/** Run properties we model as marks; everything else in `w:rPr` is preserved. */
const MODELLED_RUN_PROPERTIES = new Set([
  'w:b',
  'w:i',
  'w:u',
  'w:strike',
  'w:vertAlign',
  'w:color',
  'w:highlight',
  'w:sz',
  'w:szCs',
  'w:rFonts',
  'w:rStyle',
])

const HEADING_STYLE = /^Heading([1-6])$/i

const NO_THEME: ThemeFonts = { major: null, minor: null }

function parseRunProperties(
  rPr: XmlNode | undefined,
  theme: ThemeFonts,
): {
  marks: Mark[]
  preserved: string[]
  original: string | null
} {
  if (!rPr) return { marks: [], preserved: [], original: null }

  const marks: Mark[] = []
  const preserved: string[] = []
  const textStyle: Record<string, unknown> = {}

  for (const property of children(rPr)) {
    const tag = tagName(property)
    if (tag === null) continue

    const value = attribute(property, 'w:val')

    switch (tag) {
      case 'w:b':
        if (parseToggle(value)) marks.push({ type: 'bold' })
        break
      case 'w:i':
        if (parseToggle(value)) marks.push({ type: 'italic' })
        break
      case 'w:strike':
        if (parseToggle(value)) marks.push({ type: 'strike' })
        break
      case 'w:u':
        // `w:val="none"` is an explicit "not underlined", not an underline.
        if (value !== undefined && value !== 'none') marks.push({ type: 'underline' })
        break
      case 'w:vertAlign':
        if (value === 'superscript') marks.push({ type: 'superscript' })
        else if (value === 'subscript') marks.push({ type: 'subscript' })
        break
      case 'w:color': {
        const color = parseColor(value)
        if (color !== null) textStyle['color'] = color
        break
      }
      case 'w:highlight':
        if (value !== undefined && value !== 'none') {
          marks.push({ type: 'highlight', attrs: { color: value } })
        }
        break
      case 'w:sz': {
        const halfPoints = parseIntAttribute(value)
        if (halfPoints !== null) textStyle['fontSize'] = halfPointsToPoints(halfPoints)
        break
      }
      case 'w:szCs':
        // Complex-script size is recorded only so the serialiser can put it back
        // when it was there. Writing it unconditionally would add markup Word
        // did not have — see `docs/adr/0003-docx-native-roundtrip.md`.
        textStyle['szCs'] = value ?? null
        break
      case 'w:rStyle': {
        // The name of a style, not a description of one: the run wears it, and
        // what it looks like is stated once in `styles.xml`.
        const styleId = attribute(property, 'w:val')
        if (styleId !== undefined) {
          marks.push({ type: 'characterStyle', attrs: { styleId } })
        }
        break
      }
      case 'w:rFonts': {
        const fonts = attributes(property)
        // A theme slot names the font indirectly; resolving it here means the
        // editor shows the family the reader of the document would see.
        const family =
          fonts['w:ascii'] ??
          fonts['w:hAnsi'] ??
          resolveThemeFont(theme, fonts['w:asciiTheme'] ?? fonts['w:hAnsiTheme']) ??
          undefined
        if (family !== undefined) textStyle['fontFamily'] = family
        // The original attributes are kept verbatim so the element is rebuilt as
        // found: a document that named only `w:ascii` must not gain `w:cs`, and a
        // theme reference must go back as a slot name, never as the family it
        // resolved to. `rFontsResolved` records what this markup meant, so the
        // serialiser can tell "unchanged" from "the user picked a new font".
        if (family === undefined) {
          // Nothing resolvable — often a theme slot with no theme loaded. The
          // element is preserved rather than dropped, or the run would come back
          // from a save with its font markup missing.
          preserved.push(serializeNode(property))
        } else if (Object.keys(fonts).length > 0) {
          textStyle['rFonts'] = fonts
          textStyle['rFontsResolved'] = family
        }
        break
      }
      default:
        if (!MODELLED_RUN_PROPERTIES.has(tag)) preserved.push(serializeNode(property))
    }
  }

  if (Object.keys(textStyle).length > 0) marks.push({ type: 'textStyle', attrs: textStyle })

  return { marks, preserved, original: serializeNode(rPr) }
}

/**
 * Per-document counter for run keys. Reset on each parse so a document's keys
 * start from zero and stay stable between runs of the parser.
 */
let runKeyCounter = 0

function nextRunKey(): number {
  runKeyCounter += 1
  return runKeyCounter
}

/** The modelled run properties, as a comparable string. See `paragraphSignature`. */
export function runSignature(marks: readonly Mark[]): string {
  const names = marks
    // `link` is the `w:hyperlink` element around the run, not a run property, so
    // it must not make an untouched `w:rPr` look edited.
    .filter((mark) => mark.type !== 'preservedRunProperties' && mark.type !== 'link')
    .map((mark) => `${mark.type}:${JSON.stringify(sortedAttrs(mark.attrs))}`)
    .sort()
  return JSON.stringify(names)
}

function sortedAttrs(attrs: Record<string, unknown> | undefined): [string, unknown][] {
  if (!attrs) return []
  return Object.entries(attrs)
    .filter(([key]) => key !== 'rFonts' && key !== 'rFontsResolved' && key !== 'szCs')
    .sort(([a], [b]) => a.localeCompare(b))
}

interface ParagraphProperties {
  /** The original `w:pPr`, written back verbatim when nothing modelled changed. */
  original: string | null
  styleId: string | null
  headingLevel: number | null
  textAlign: string | null
  lineHeight: number | null
  spaceBefore: number | null
  spaceAfter: number | null
  indentLeft: number | null
  indentRight: number | null
  indentFirstLine: number | null
  numbering: { numId: number; level: number } | null
  /** Pagination toggles. Null means the paragraph says nothing either way. */
  tabs: TabStop[]
  /** `w:sectPr` carried by this paragraph, which ends a section after it. */
  sectionBreak: string | null
  keepNext: boolean | null
  keepLines: boolean | null
  pageBreakBefore: boolean | null
  widowControl: boolean | null
  preserved: string[]
}

/**
 * The pagination toggles, in the order `w:pPr` requires them.
 *
 * Each is an OOXML toggle: present means on, `w:val="0"` means explicitly off.
 * The distinction matters for `w:widowControl`, which Word turns on by default
 * — a paragraph that switches it off has to say so, and dropping that changes
 * how the document breaks across pages.
 */
export const PAGINATION_PROPERTIES = [
  ['w:keepNext', 'keepNext'],
  ['w:keepLines', 'keepLines'],
  ['w:pageBreakBefore', 'pageBreakBefore'],
  ['w:widowControl', 'widowControl'],
] as const

/**
 * `w:pPr` children we rebuild from attributes. Everything else is preserved —
 * including `w:rPr`, which is the formatting of the paragraph *mark* rather than
 * of its text. Dropping it changes how Word spaces the paragraph, and it is
 * invisible in the editor, so nothing would ever prompt a user to restore it.
 */
const MODELLED_PARAGRAPH_PROPERTIES = new Set([
  'w:pStyle',
  'w:jc',
  'w:spacing',
  'w:ind',
  'w:numPr',
  'w:tabs',
  'w:sectPr',
  'w:keepNext',
  'w:keepLines',
  'w:pageBreakBefore',
  'w:widowControl',
])

function parseParagraphProperties(pPr: XmlNode | undefined): ParagraphProperties {
  const result: ParagraphProperties = {
    original: pPr === undefined ? null : serializeNode(pPr),
    styleId: null,
    headingLevel: null,
    textAlign: null,
    lineHeight: null,
    spaceBefore: null,
    spaceAfter: null,
    indentLeft: null,
    indentRight: null,
    indentFirstLine: null,
    numbering: null,
    tabs: [],
    sectionBreak: null,
    keepNext: null,
    keepLines: null,
    pageBreakBefore: null,
    widowControl: null,
    preserved: [],
  }

  if (!pPr) return result

  for (const property of children(pPr)) {
    const tag = tagName(property)
    if (tag === null) continue

    switch (tag) {
      case 'w:pStyle': {
        const styleId = attribute(property, 'w:val') ?? null
        result.styleId = styleId
        const heading = styleId ? HEADING_STYLE.exec(styleId) : null
        if (heading?.[1]) result.headingLevel = Number.parseInt(heading[1], 10)
        break
      }
      case 'w:jc': {
        const value = attribute(property, 'w:val')
        // OOXML calls it `both`; CSS and our schema call it `justify`.
        result.textAlign = value === 'both' ? 'justify' : (value ?? null)
        break
      }
      case 'w:spacing': {
        const line = parseIntAttribute(attribute(property, 'w:line'))
        const lineRule = attribute(property, 'w:lineRule')
        // `exact` and `atLeast` are absolute values, not multipliers; those are
        // preserved rather than approximated into a line-height.
        if (line !== null && (lineRule === undefined || lineRule === 'auto')) {
          result.lineHeight = lineUnitsToMultiplier(line)
        }
        const before = parseIntAttribute(attribute(property, 'w:before'))
        const after = parseIntAttribute(attribute(property, 'w:after'))
        if (before !== null) result.spaceBefore = twipsToPoints(before)
        if (after !== null) result.spaceAfter = twipsToPoints(after)
        break
      }
      case 'w:ind': {
        const left = parseIntAttribute(
          attribute(property, 'w:left') ?? attribute(property, 'w:start'),
        )
        const right = parseIntAttribute(
          attribute(property, 'w:right') ?? attribute(property, 'w:end'),
        )
        const firstLine = parseIntAttribute(attribute(property, 'w:firstLine'))
        const hanging = parseIntAttribute(attribute(property, 'w:hanging'))

        if (left !== null) result.indentLeft = twipsToPoints(left)
        if (right !== null) result.indentRight = twipsToPoints(right)
        if (firstLine !== null) result.indentFirstLine = twipsToPoints(firstLine)
        // A hanging indent is a negative first-line indent.
        else if (hanging !== null) result.indentFirstLine = -twipsToPoints(hanging)
        break
      }
      case 'w:numPr': {
        const numId = parseIntAttribute(attribute(findChild(property, 'w:numId') ?? {}, 'w:val'))
        const level = parseIntAttribute(attribute(findChild(property, 'w:ilvl') ?? {}, 'w:val'))
        if (numId !== null) result.numbering = { numId, level: level ?? 0 }
        break
      }
      case 'w:tabs':
        result.tabs = parseTabs(property)
        break
      case 'w:sectPr':
        result.sectionBreak = serializeNode(property)
        break
      case 'w:keepNext':
      case 'w:keepLines':
      case 'w:pageBreakBefore':
      case 'w:widowControl': {
        const name = PAGINATION_PROPERTIES.find(([element]) => element === tag)?.[1]
        if (name !== undefined) result[name] = parseToggle(attribute(property, 'w:val'))
        break
      }
      default:
        if (!MODELLED_PARAGRAPH_PROPERTIES.has(tag)) result.preserved.push(serializeNode(property))
    }
  }

  // The section break is carried out of the paragraph as a block of its own, so
  // the preserved `w:pPr` must not still contain it — the two would both be
  // written back and the document would gain a section on every save.
  if (result.sectionBreak !== null) {
    const withoutSection = children(pPr).filter((child) => tagName(child) !== 'w:sectPr')
    result.original = serializeNode(element('w:pPr', attributesOf(pPr), withoutSection))
  }

  return result
}

function parseRun(
  run: XmlNode,
  warnings: ParseWarning[],
  theme: ThemeFonts,
  resolveImage?: (relationshipId: string) => string | null,
  footnoteText?: (id: number) => string,
): ProseMirrorNodeJson[] {
  const { marks, preserved, original } = parseRunProperties(findChild(run, 'w:rPr'), theme)
  const allMarks = [...marks]

  // Every parsed run carries a key, so the serialiser can put its content back
  // in the same runs it came from. Word splits runs for reasons of its own —
  // revision tracking, spell-check state — and merging two runs that happen to
  // share properties would rewrite structure nobody asked us to touch.
  allMarks.push({
    type: 'preservedRunProperties',
    attrs: {
      runKey: nextRunKey(),
      ...(preserved.length > 0 ? { xml: preserved.join('') } : {}),
      ...(original === null ? {} : { rPrOriginal: original, rPrSignature: runSignature(marks) }),
    },
  })

  const nodes: ProseMirrorNodeJson[] = []

  for (const child of children(run)) {
    const tag = tagName(child)

    switch (tag) {
      case 'w:t': {
        const text = children(child).filter(isTextNode).map(textValue).join('')
        if (text !== '') {
          nodes.push({ type: 'text', text, ...(allMarks.length > 0 ? { marks: allMarks } : {}) })
        }
        break
      }
      case 'w:br': {
        const type = attribute(child, 'w:type')
        // A break belongs to its run and carries its properties; parsing it as a
        // bare node would strip them and split the run on the way back out.
        const marks = allMarks.length > 0 ? { marks: allMarks } : {}
        if (type === 'page') nodes.push({ type: 'pageBreak', ...marks })
        else {
          nodes.push({
            type: 'hardBreak',
            ...(type === undefined ? {} : { attrs: { breakType: type } }),
            ...marks,
          })
        }
        break
      }
      case 'w:tab':
        nodes.push({
          type: 'text',
          text: '\t',
          ...(allMarks.length > 0 ? { marks: allMarks } : {}),
        })
        break
      case 'w:rPr':
        break
      case 'w:footnoteReference': {
        const id = parseInt2(attribute(child, 'w:id'))
        if (id !== null) {
          nodes.push({
            type: 'footnote',
            attrs: { footnoteId: id, text: footnoteText?.(id) ?? '' },
          })
        }
        break
      }
      case 'w:drawing': {
        const image = parseDrawing(child)
        if (image === null) {
          // A floating or anchored drawing: preserved rather than flattened into
          // the text flow, which would move it on the page.
          nodes.push({
            type: 'passthroughInline',
            attrs: { xml: serializeNode(child), tag: 'w:drawing' },
            // Carries the run's marks so it goes back inside that run.
            ...(allMarks.length > 0 ? { marks: allMarks } : {}),
          })
          warnings.push({
            tag: 'w:drawing',
            message: 'A floating image is preserved but cannot be moved or resized yet.',
          })
          break
        }
        // The run's properties belong to the picture's run; without them the
        // rebuilt `w:r` would lose whatever the source declared on it.
        const node = imageNode(image, resolveImage?.(image.relationshipId) ?? '')
        nodes.push(allMarks.length > 0 ? { ...node, marks: allMarks } : node)
        break
      }
      default:
        if (tag !== null) {
          // Carries the run's marks so it is written back *inside* that run.
          // Hoisting it to paragraph level would drop the `w:r` wrapper, which
          // is where a VML picture or an AlternateContent block lives.
          nodes.push({
            type: 'passthroughInline',
            attrs: { xml: serializeNode(child), tag },
            ...(allMarks.length > 0 ? { marks: allMarks } : {}),
          })
          warnings.push({ tag, message: `Run content <${tag}> is preserved but not editable.` })
        }
    }
  }

  return nodes
}

function parseParagraph(
  paragraph: XmlNode,
  warnings: ParseWarning[],
  theme: ThemeFonts,
  resolveImage?: (relationshipId: string) => string | null,
  footnoteText?: (id: number) => string,
): ProseMirrorNodeJson {
  const properties = parseParagraphProperties(findChild(paragraph, 'w:pPr'))
  const content: ProseMirrorNodeJson[] = []

  for (const child of children(paragraph)) {
    const tag = tagName(child)

    switch (tag) {
      case 'w:pPr':
        break
      case 'w:r':
        content.push(...parseRun(child, warnings, theme, resolveImage, footnoteText))
        break
      case 'w:hyperlink': {
        // The relationship id is resolved against document.xml.rels by the caller;
        // the anchor form is kept as-is.
        const relationshipId = attribute(child, 'r:id')
        const anchor = attribute(child, 'w:anchor')
        const inner = children(child).flatMap((run) =>
          tagName(run) === 'w:r' ? parseRun(run, warnings, theme, resolveImage, footnoteText) : [],
        )
        const href = relationshipId ?? (anchor !== undefined ? `#${anchor}` : null)
        for (const node of inner) {
          if (node.type !== 'text' || href === null) continue
          node.marks = [
            ...(node.marks ?? []),
            { type: 'link', attrs: { href, 'data-rel-id': relationshipId ?? null } },
          ]
        }
        content.push(...inner)
        break
      }
      case 'w:proofErr':
        // Spell-check state, regenerated by Word on its own. The only element
        // here that is genuinely safe to drop.
        break
      case 'w:bookmarkStart':
      case 'w:bookmarkEnd':
        // Not droppable: bookmarks are the targets of internal links and the
        // anchors a table of contents points at. Losing them silently breaks
        // every cross-reference in the document.
        content.push({
          type: 'passthroughInline',
          attrs: { xml: serializeNode(child), tag },
        })
        break
      default:
        if (tag !== null) {
          content.push({ type: 'passthroughInline', attrs: { xml: serializeNode(child), tag } })
          warnings.push({
            tag,
            message: `Paragraph content <${tag}> is preserved but not editable.`,
          })
        }
    }
  }

  const attrs: Record<string, unknown> = {}
  if (properties.textAlign !== null) attrs['textAlign'] = properties.textAlign
  if (properties.lineHeight !== null) attrs['lineHeight'] = properties.lineHeight
  if (properties.spaceBefore !== null) attrs['spaceBefore'] = properties.spaceBefore
  if (properties.spaceAfter !== null) attrs['spaceAfter'] = properties.spaceAfter
  if (properties.indentLeft !== null) attrs['indentLeft'] = properties.indentLeft
  if (properties.indentRight !== null) attrs['indentRight'] = properties.indentRight
  if (properties.indentFirstLine !== null) attrs['indentFirstLine'] = properties.indentFirstLine
  if (properties.sectionBreak !== null) attrs['sectionBreak'] = properties.sectionBreak
  for (const [, name] of PAGINATION_PROPERTIES) {
    if (properties[name] !== null) attrs[name] = properties[name]
  }
  if (properties.tabs.length > 0) attrs['tabs'] = properties.tabs
  if (properties.preserved.length > 0) attrs['preservedPPr'] = properties.preserved.join('')
  if (properties.numbering !== null) attrs['numbering'] = properties.numbering

  // Word writes properties in ways we do not reproduce exactly — `w:lineRule`
  // without `w:line`, `w:val="1"` on a toggle, attribute orders of its own. The
  // original element is kept so a paragraph nobody edited goes back byte for
  // byte; `pPrSignature` records what it meant, so an edit is detectable.
  // The style and heading level belong in the signature, so they are added
  // before it is taken. Computing it earlier made every heading look edited, and
  // the rebuilt `w:pPr` put its children in our order rather than Word's.
  if (properties.headingLevel !== null) {
    attrs['level'] = properties.headingLevel
    attrs['styleId'] = properties.styleId
  } else if (properties.styleId !== null) {
    attrs['styleId'] = properties.styleId
  }

  if (properties.original !== null) {
    attrs['pPrOriginal'] = properties.original
    attrs['pPrSignature'] = paragraphSignature(attrs)
  }

  if (properties.headingLevel !== null) {
    return {
      type: 'heading',
      attrs,
      ...(content.length > 0 ? { content } : {}),
    }
  }

  return {
    type: 'paragraph',
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(content.length > 0 ? { content } : {}),
  }
}

export interface ParseContext {
  /** Theme fonts from `word/theme/theme1.xml`, for resolving `w:*Theme` slots. */
  theme?: ThemeFonts
  /**
   * Turns a relationship id into something the webview can display — a blob or
   * data URL for the media part it points at. Without it images still parse and
   * round-trip, they just do not render.
   */
  resolveImage?: (relationshipId: string) => string | null
  /** Note text by footnote id, from `word/footnotes.xml`. */
  footnoteText?: (id: number) => string
  /**
   * Definitions from `word/numbering.xml`.
   *
   * Without them the numbered paragraphs still parse, but nothing says whether
   * a list is bulleted or numbered, so they are left as the paragraphs they are
   * in the file rather than guessed at.
   */
  numbering?: NumberingCatalogue
}

/**
 * Groups the paragraphs of a list into the list they belong to.
 *
 * OOXML has no list element: a list is a run of paragraphs that happen to point
 * at the same numbering definition, with their depth in `w:ilvl`. Left as
 * paragraphs they render with no marker at all — the text of a list without any
 * sign that it is one.
 */
function groupLists(
  blocks: readonly ProseMirrorNodeJson[],
  catalogue: NumberingCatalogue | undefined,
): ProseMirrorNodeJson[] {
  if (catalogue === undefined) return [...blocks]

  const grouped: ProseMirrorNodeJson[] = []
  const lists = listBuilder(grouped)

  for (const block of blocks) {
    const numbering = block.attrs?.['numbering']
    if (typeof numbering !== 'object' || numbering === null) {
      lists.close()
      grouped.push(block)
      continue
    }

    const { numId, level } = numbering as { numId: number; level: number }
    const kind = isBulletList(catalogue, numId, level) ? 'bulletList' : 'orderedList'

    lists.addItem(kind, level, [block])
  }

  lists.close()
  return grouped
}

/**
 * A table and everything inside its cells.
 *
 * A cell holds block content, not just paragraphs — nested tables are common in
 * real documents, and taking only `w:p` children silently deletes them along
 * with every word they contain.
 */
function parseTableBlock(
  table: XmlNode,
  warnings: ParseWarning[],
  theme: ThemeFonts,
  resolveImage?: (relationshipId: string) => string | null,
  footnoteText?: (id: number) => string,
): ProseMirrorNodeJson {
  return parseTable(table, (cell) =>
    children(cell).flatMap((node): ProseMirrorNodeJson[] => {
      const tag = tagName(node)

      if (tag === 'w:p') {
        return [parseParagraph(node, warnings, theme, resolveImage, footnoteText)]
      }
      if (tag === 'w:tbl') {
        return [parseTableBlock(node, warnings, theme, resolveImage, footnoteText)]
      }
      if (tag === null || tag === 'w:tcPr' || isTextNode(node)) return []

      warnings.push({ tag, message: `<${tag}> inside a table cell is preserved but not editable.` })
      return [{ type: 'passthroughBlock', attrs: { xml: serializeNode(node), tag } }]
    }),
  )
}

export function parseDocument(xml: string, context: ParseContext = {}): ParsedDocument {
  const theme = context.theme ?? NO_THEME
  const resolveImage = context.resolveImage
  const footnoteText = context.footnoteText
  runKeyCounter = 0
  const warnings: ParseWarning[] = []
  const roots = parseXml(xml)

  const document = roots.find((node) => tagName(node) === 'w:document')
  if (!document) {
    return {
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      warnings: [{ tag: 'w:document', message: 'document.xml has no <w:document> root.' }],
      sectionProperties: null,
      documentAttributes: {},
      alwaysPreserveSpace: false,
    }
  }

  const body = findChild(document, 'w:body')
  const blocks: ProseMirrorNodeJson[] = []
  let sectionProperties: string | null = null

  for (const child of body ? children(body) : []) {
    const tag = tagName(child)

    switch (tag) {
      case 'w:p': {
        const paragraph = parseParagraph(child, warnings, theme, resolveImage, footnoteText)
        const sectPr = paragraph.attrs?.['sectionBreak']

        if (typeof sectPr !== 'string') {
          blocks.push(paragraph)
          break
        }

        // A section ends at the paragraph whose properties carry it. Shown as a
        // block of its own, so it can be seen, selected and removed — as a
        // paragraph attribute it would be invisible and undeletable.
        const { sectionBreak: _carried, ...rest } = paragraph.attrs ?? {}
        blocks.push({ ...paragraph, attrs: rest })
        blocks.push({ type: 'sectionBreak', attrs: { sectPr } })
        break
      }
      case 'w:tbl':
        blocks.push(parseTableBlock(child, warnings, theme, resolveImage, footnoteText))
        break
      case 'w:sectPr':
        sectionProperties = serializeNode(child)
        break
      default:
        if (tag !== null) {
          blocks.push({ type: 'passthroughBlock', attrs: { xml: serializeNode(child), tag } })
          warnings.push({ tag, message: `<${tag}> is preserved but cannot be edited yet.` })
        }
    }
  }

  const content = groupLists(blocks, context.numbering)

  // ProseMirror requires at least one block.
  if (content.length === 0) content.push({ type: 'paragraph' })

  return {
    doc: { type: 'doc', content },
    warnings,
    sectionProperties,
    documentAttributes: attributesOf(document),
    alwaysPreserveSpace: detectSpaceConvention(xml),
  }
}

/**
 * True when every `w:t` in the source declared `xml:space="preserve"`.
 *
 * Counted rather than sampled: a document that uses it on most runs but not all
 * has no convention to follow, and our own rule — add it only where whitespace
 * would be lost — is the safe fallback.
 */
export function detectSpaceConvention(xml: string): boolean {
  let total = 0
  let withSpace = 0

  for (const match of xml.matchAll(/<w:t(\s[^>]*)?>/gu)) {
    total += 1
    if (match[1]?.includes('xml:space') === true) withSpace += 1
  }

  return total > 0 && withSpace === total
}

/**
 * The modelled values of a paragraph, as a comparable string.
 *
 * Only what the serialiser would rebuild: if these match what the parser saw,
 * the original markup is still correct and is written back untouched.
 */
export function paragraphSignature(attrs: Record<string, unknown>): string {
  return JSON.stringify([
    attrs['styleId'] ?? null,
    attrs['level'] ?? null,
    attrs['textAlign'] ?? null,
    attrs['lineHeight'] ?? null,
    attrs['spaceBefore'] ?? null,
    attrs['spaceAfter'] ?? null,
    attrs['indentLeft'] ?? null,
    attrs['indentRight'] ?? null,
    attrs['indentFirstLine'] ?? null,
    attrs['numbering'] ?? null,
    attrs['tabs'] ?? null,
    attrs['keepNext'] ?? null,
    attrs['keepLines'] ?? null,
    attrs['pageBreakBefore'] ?? null,
    attrs['widowControl'] ?? null,
  ])
}

function attributesOf(node: XmlNode): Record<string, string> {
  const raw = node[':@']
  if (typeof raw !== 'object' || raw === null) return {}

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key.replace(/^@_/, '')] = String(value)
  }
  return result
}
