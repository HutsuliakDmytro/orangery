import { buildXml, children, deserializeNode, element, textNode, withDeclaration } from './xml'
import type { XmlNode } from './xml'
import { formatColor, multiplierToLineUnits, pointsToHalfPoints, pointsToTwips } from './units'
import { PAGINATION_PROPERTIES, paragraphSignature, runSignature } from './parse-document'
import type { ParsedDocument, ProseMirrorNodeJson } from './parse-document'
import { footnoteReferenceRun } from './footnotes'
import { buildDrawing } from './image'
import { sequenceField, styleReferenceField } from './fields'
import { captionKindOf, numberCaptions, SEQUENCE_NAMES } from './captions'
import { serializeTabs } from './tabs'
import type { TabStop } from './tabs'
import type { CaptionNumber } from './captions'
import type { ImageWrap } from './image'
import { serializeTable } from './table'
import { buildTocField } from './toc-field'
import type { TocEntry } from './toc-field'

/**
 * ProseMirror JSON → `word/document.xml`.
 *
 * Anything carried as passthrough is written back verbatim; everything else is
 * rebuilt from the attributes the parser produced. The two halves are mirror
 * images by construction, which is what the round-trip tests verify.
 */

export interface SerializeOptions {
  /** `w:document` attributes from the source, so namespaces survive. */
  documentAttributes: Record<string, string>
  /** Original `w:sectPr`, appended to the body unchanged. */
  sectionProperties: string | null
  /** Match the source's `xml:space` convention — see `detectSpaceConvention`. */
  alwaysPreserveSpace?: boolean
  /**
   * Reserves a numbering id for a list the editor created.
   *
   * OOXML has no list element: a list is a run of paragraphs that share a
   * `w:numPr`. Without a definition to point at, Word renders them as plain
   * body text, so the caller supplies one.
   */
  allocateNumbering?: (kind: 'bullet' | 'ordered') => number
  /**
   * Whether captions count within a chapter.
   *
   * Follows the heading numbering: "Figure 1.2" means nothing in a document
   * whose chapters have no numbers.
   */
  captionsByChapter?: boolean
}

type Mark = NonNullable<ProseMirrorNodeJson['marks']>[number]

function markMap(marks: Mark[] | undefined): Map<string, Mark> {
  return new Map((marks ?? []).map((mark) => [mark.type, mark]))
}

function numberAttr(attrs: Record<string, unknown> | undefined, key: string): number | null {
  const value = attrs?.[key]
  return typeof value === 'number' ? value : null
}

function stringAttr(attrs: Record<string, unknown> | undefined, key: string): string | null {
  const value = attrs?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function parsedNodes(xml: string | null): XmlNode[] {
  if (!xml) return []
  const parsed = deserializeNode(`<root>${xml}</root>`)
  if (!parsed) return []
  const value = parsed['root']
  return Array.isArray(value) ? (value as XmlNode[]) : []
}

/** Rebuilds `w:rPr` from marks, re-appending whatever was preserved verbatim. */
function buildRunProperties(marks: Map<string, Mark>): XmlNode | null {
  // Unchanged since parsing: Word's own markup goes back untouched. It spells
  // toggles as `w:val="1"`, writes attributes in its own order, and includes
  // properties we do not model — rebuilding would quietly rewrite all of it.
  const preserved = marks.get('preservedRunProperties')?.attrs
  const original = stringAttr(preserved, 'rPrOriginal')
  const signature = stringAttr(preserved, 'rPrSignature')

  if (original !== null && signature !== null) {
    const current = runSignature([...marks.values()])
    if (current === signature) return parsedNodes(original)[0] ?? null
  }

  const properties: XmlNode[] = []

  // `w:rStyle` comes first among the run properties, and everything after it
  // refines what the style already says.
  const characterStyle = stringAttr(marks.get('characterStyle')?.attrs, 'styleId')
  if (characterStyle !== null) properties.push(element('w:rStyle', { 'w:val': characterStyle }))

  if (marks.has('bold')) properties.push(element('w:b'))
  if (marks.has('italic')) properties.push(element('w:i'))
  if (marks.has('strike')) properties.push(element('w:strike'))
  if (marks.has('underline')) properties.push(element('w:u', { 'w:val': 'single' }))

  if (marks.has('superscript')) {
    properties.push(element('w:vertAlign', { 'w:val': 'superscript' }))
  } else if (marks.has('subscript')) {
    properties.push(element('w:vertAlign', { 'w:val': 'subscript' }))
  }

  const textStyle = marks.get('textStyle')?.attrs
  const fontFamily = stringAttr(textStyle, 'fontFamily')
  if (fontFamily !== null) {
    const recorded = textStyle?.['rFonts']
    const original =
      typeof recorded === 'object' && recorded !== null
        ? (recorded as Record<string, string>)
        : null

    if (original !== null && stringAttr(textStyle, 'rFontsResolved') === fontFamily) {
      // Unchanged since parsing: write the original markup back untouched. A
      // document that named only `w:ascii` must not gain `w:cs`, and a theme
      // reference must go back as `w:asciiTheme="minorHAnsi"` — writing the
      // resolved family into that attribute produces invalid OOXML.
      properties.push(element('w:rFonts', original))
    } else {
      // A font the user picked; Word writes all three scopes for new text.
      properties.push(
        element('w:rFonts', {
          'w:ascii': fontFamily,
          'w:hAnsi': fontFamily,
          'w:cs': fontFamily,
        }),
      )
    }
  }

  const color = stringAttr(textStyle, 'color')
  if (color !== null) properties.push(element('w:color', { 'w:val': formatColor(color) }))

  const fontSize = numberAttr(textStyle, 'fontSize')
  if (fontSize !== null) {
    const halfPoints = String(pointsToHalfPoints(fontSize))
    properties.push(element('w:sz', { 'w:val': halfPoints }))

    // `w:szCs` is written back only when the source carried it. `szCs: undefined`
    // means "not in the source"; an explicit null means it was there without a value.
    const szCs = textStyle?.['szCs']
    if (szCs !== undefined) {
      properties.push(element('w:szCs', typeof szCs === 'string' ? { 'w:val': szCs } : {}))
    }
  }

  const highlight = stringAttr(marks.get('highlight')?.attrs, 'color')
  if (highlight !== null) properties.push(element('w:highlight', { 'w:val': highlight }))

  properties.push(...parsedNodes(stringAttr(marks.get('preservedRunProperties')?.attrs, 'xml')))

  return properties.length > 0 ? element('w:rPr', {}, properties) : null
}

/**
 * Word requires `xml:space="preserve"` or leading and trailing spaces are
 * dropped. `always` follows a source that declared it everywhere.
 */
function buildTextElement(text: string, always: boolean): XmlNode {
  const needsPreserve = always || text !== text.trim() || text === ''
  return element('w:t', needsPreserve ? { 'xml:space': 'preserve' } : {}, [textNode(text)])
}

/** The content of a run: text with tabs split out into their own elements. */
function buildRunContent(text: string, alwaysPreserveSpace: boolean): XmlNode[] {
  const nodes: XmlNode[] = []

  const segments = text.split('\t')
  segments.forEach((segment, index) => {
    if (index > 0) nodes.push(element('w:tab'))
    if (segment !== '') nodes.push(buildTextElement(segment, alwaysPreserveSpace))
  })

  return nodes
}

function buildRun(text: string, marks: Map<string, Mark>, alwaysPreserveSpace: boolean): XmlNode {
  const properties = buildRunProperties(marks)
  return element('w:r', {}, [
    ...(properties ? [properties] : []),
    ...buildRunContent(text, alwaysPreserveSpace),
  ])
}

/**
 * Identifies a set of marks, so consecutive content can be grouped by it.
 *
 * Includes the run key, which is what keeps content from two source runs out of
 * one run on the way back — see `nextRunKey` in the parser.
 */
function markSignature(marks: Mark[] | undefined): string {
  return JSON.stringify(
    (marks ?? []).map((mark) => `${mark.type}:${JSON.stringify(mark.attrs ?? {})}`).sort(),
  )
}

/** The `w:br` element itself; the run around it is built by the grouping pass. */
function buildBreak(node: ProseMirrorNodeJson): XmlNode {
  if (node.type === 'pageBreak') return element('w:br', { 'w:type': 'page' })

  // `textWrapping` is the default, so Word omits it — but a source that wrote it
  // explicitly gets it back.
  const breakType = stringAttr(node.attrs, 'breakType')
  return element('w:br', breakType === null ? {} : { 'w:type': breakType })
}

function buildParagraphProperties(
  node: ProseMirrorNodeJson,
  sectionBreak?: string,
): XmlNode | null {
  const attrs = node.attrs

  /** `w:sectPr` comes last among the paragraph properties. */
  const withSection = (pPr: XmlNode | null): XmlNode | null => {
    if (sectionBreak === undefined) return pPr

    const existing = pPr === null ? [] : children(pPr)
    return element('w:pPr', {}, [...existing, ...parsedNodes(sectionBreak)])
  }

  const original = stringAttr(attrs, 'pPrOriginal')
  const signature = stringAttr(attrs, 'pPrSignature')
  if (original !== null && signature !== null && paragraphSignature(attrs ?? {}) === signature) {
    return withSection(parsedNodes(original)[0] ?? null)
  }

  const properties: XmlNode[] = []

  const level = numberAttr(attrs, 'level')
  const styleId =
    stringAttr(attrs, 'styleId') ?? (level !== null ? `Heading${String(level)}` : null)
  if (styleId !== null) properties.push(element('w:pStyle', { 'w:val': styleId }))

  // OOXML fixes the order of `w:pPr` children: the pagination toggles come
  // between the style and the numbering.
  for (const [tag, name] of PAGINATION_PROPERTIES) {
    const value = attrs?.[name]
    if (typeof value !== 'boolean') continue
    properties.push(element(tag, value ? {} : { 'w:val': '0' }))
  }

  const numbering = attrs?.['numbering']
  if (typeof numbering === 'object' && numbering !== null) {
    const { numId, level: ilvl } = numbering as { numId?: number; level?: number }
    if (typeof numId === 'number') {
      properties.push(
        element('w:numPr', {}, [
          element('w:ilvl', { 'w:val': String(ilvl ?? 0) }),
          element('w:numId', { 'w:val': String(numId) }),
        ]),
      )
    }
  }

  // `w:tabs` sits after the numbering and before the spacing.
  const tabs = attrs?.['tabs']
  if (Array.isArray(tabs)) {
    const stops = serializeTabs(tabs as TabStop[])
    if (stops !== null) properties.push(stops)
  }

  const spacingAttributes: Record<string, string> = {}
  const spaceBefore = numberAttr(attrs, 'spaceBefore')
  const spaceAfter = numberAttr(attrs, 'spaceAfter')
  const lineHeight = numberAttr(attrs, 'lineHeight')
  if (spaceBefore !== null) spacingAttributes['w:before'] = String(pointsToTwips(spaceBefore))
  if (spaceAfter !== null) spacingAttributes['w:after'] = String(pointsToTwips(spaceAfter))
  if (lineHeight !== null) {
    spacingAttributes['w:line'] = String(multiplierToLineUnits(lineHeight))
    spacingAttributes['w:lineRule'] = 'auto'
  }
  if (Object.keys(spacingAttributes).length > 0) {
    properties.push(element('w:spacing', spacingAttributes))
  }

  const indentAttributes: Record<string, string> = {}
  const indentLeft = numberAttr(attrs, 'indentLeft')
  const indentRight = numberAttr(attrs, 'indentRight')
  const indentFirstLine = numberAttr(attrs, 'indentFirstLine')
  if (indentLeft !== null) indentAttributes['w:left'] = String(pointsToTwips(indentLeft))
  if (indentRight !== null) indentAttributes['w:right'] = String(pointsToTwips(indentRight))
  if (indentFirstLine !== null) {
    // Negative first-line indent is a hanging indent in OOXML terms.
    if (indentFirstLine < 0) {
      indentAttributes['w:hanging'] = String(pointsToTwips(-indentFirstLine))
    } else {
      indentAttributes['w:firstLine'] = String(pointsToTwips(indentFirstLine))
    }
  }
  if (Object.keys(indentAttributes).length > 0) {
    properties.push(element('w:ind', indentAttributes))
  }

  const textAlign = stringAttr(attrs, 'textAlign')
  if (textAlign !== null) {
    properties.push(element('w:jc', { 'w:val': textAlign === 'justify' ? 'both' : textAlign }))
  }

  properties.push(...parsedNodes(stringAttr(attrs, 'preservedPPr')))

  return withSection(properties.length > 0 ? element('w:pPr', {}, properties) : null)
}

/**
 * The label and number a caption paragraph opens with.
 *
 * Written as real fields rather than as the text the editor draws: Word then
 * renumbers them itself when a figure is inserted above, and a reader that
 * cannot calculate fields still shows the number as it stood.
 */
function buildCaptionLabel(node: ProseMirrorNodeJson, numbered: CaptionNumber | undefined): XmlNode[] {
  const kind = captionKindOf(node.attrs?.['captionKind'])
  if (kind === undefined || numbered === undefined) return []

  const [chapterValue, ownValue] = numbered.number.split('.')
  const own = numbered.chapter === null ? numbered.number : (ownValue ?? numbered.number)

  return [
    element('w:r', {}, [element('w:t', { 'xml:space': 'preserve' }, [textNode(`${SEQUENCE_NAMES[kind]} `)])]),
    ...(numbered.chapter === null
      ? []
      : [
          ...styleReferenceField(1, chapterValue ?? String(numbered.chapter)),
          element('w:r', {}, [element('w:t', {}, [textNode('.')])]),
        ]),
    ...sequenceField(SEQUENCE_NAMES[kind], own, numbered.chapter === null ? undefined : 1),
    element('w:r', {}, [element('w:t', { 'xml:space': 'preserve' }, [textNode(' \u2014 ')])]),
  ]
}

function buildParagraph(
  node: ProseMirrorNodeJson,
  alwaysPreserveSpace: boolean,
  caption?: CaptionNumber,
  sectionBreak?: string,
): XmlNode {
  const paragraphChildren: XmlNode[] = []
  const properties = buildParagraphProperties(node, sectionBreak)
  if (properties) paragraphChildren.push(properties)

  paragraphChildren.push(...buildCaptionLabel(node, caption))

  // OOXML groups content that shares properties into one `w:r`. Emitting a run
  // per node would split a run whose text is followed by a break, and the break
  // would lose the properties it inherited.
  let pending: { marks: Map<string, Mark>; signature: string; children: XmlNode[] } | null = null

  const flush = () => {
    if (pending === null || pending.children.length === 0) {
      pending = null
      return
    }
    const properties = buildRunProperties(pending.marks)
    paragraphChildren.push(
      element('w:r', {}, [...(properties ? [properties] : []), ...pending.children]),
    )
    pending = null
  }

  const append = (marks: Map<string, Mark>, signature: string, nodes: XmlNode[]) => {
    if (pending !== null && pending.signature !== signature) flush()
    pending ??= { marks, signature, children: [] }
    pending.children.push(...nodes)
  }

  for (const child of node.content ?? []) {
    switch (child.type) {
      case 'text': {
        const marks = markMap(child.marks)
        const link = marks.get('link')

        if (link) {
          // A hyperlink wraps its own run, so it interrupts the grouping.
          flush()
          const relationshipId = stringAttr(link.attrs, 'data-rel-id')
          const href = stringAttr(link.attrs, 'href')
          const anchor = href?.startsWith('#') === true ? href.slice(1) : null

          paragraphChildren.push(
            element(
              'w:hyperlink',
              relationshipId !== null
                ? { 'r:id': relationshipId }
                : anchor !== null
                  ? { 'w:anchor': anchor }
                  : {},
              [buildRun(child.text ?? '', marks, alwaysPreserveSpace)],
            ),
          )
          break
        }

        append(
          marks,
          markSignature(child.marks),
          buildRunContent(child.text ?? '', alwaysPreserveSpace),
        )
        break
      }
      case 'hardBreak':
      case 'pageBreak':
        append(markMap(child.marks), markSignature(child.marks), [buildBreak(child)])
        break
      case 'footnote': {
        flush()
        const id = numberAttr(child.attrs, 'footnoteId')
        if (id !== null) paragraphChildren.push(footnoteReferenceRun(id))
        break
      }
      case 'passthroughInline': {
        const nodes = parsedNodes(stringAttr(child.attrs, 'xml'))
        const marks = markMap(child.marks)

        // Content that came from inside a run goes back inside it; a bookmark,
        // which sits between runs, does not.
        if (marks.has('preservedRunProperties')) {
          append(marks, markSignature(child.marks), nodes)
        } else {
          flush()
          paragraphChildren.push(...nodes)
        }
        break
      }
      case 'image': {
        const original = stringAttr(child.attrs, 'drawing')
        const relationshipId = stringAttr(child.attrs, 'relationshipId')
        const width = numberAttr(child.attrs, 'width')
        const height = numberAttr(child.attrs, 'height')

        const marks = markMap(child.marks)
        const signature = markSignature(child.marks)

        // A picture lives in a run and inherits its properties, so it joins the
        // current group rather than starting a bare `w:r` of its own.
        const wrapUnchanged =
          stringAttr(child.attrs, 'wrap') === stringAttr(child.attrs, 'drawingWrap')

        if (
          original !== null &&
          wrapUnchanged &&
          width === numberAttr(child.attrs, 'drawingWidth')
        ) {
          append(marks, signature, parsedNodes(original))
          break
        }

        if (relationshipId !== null) {
          append(marks, signature, [
            buildDrawing({
              relationshipId,
              width: width ?? 0,
              height: height ?? 0,
              alt: stringAttr(child.attrs, 'alt') ?? '',
              id: numberAttr(child.attrs, 'imageId') ?? 1,
              wrap: (stringAttr(child.attrs, 'wrap') as ImageWrap | null) ?? 'inline',
            }),
          ])
        }
        break
      }
      default:
        break
    }
  }

  flush()

  return element('w:p', {}, paragraphChildren)
}

interface BlockContext {
  alwaysPreserveSpace: boolean
  allocateNumbering?: (kind: 'bullet' | 'ordered') => number
  /** Numbering reference inherited from the list this block sits in. */
  numbering?: { numId: number; level: number }
  /** Caption numbers by the block they belong to, computed for the whole body. */
  captions?: Map<ProseMirrorNodeJson, CaptionNumber>
  /** A `w:sectPr` the block being written has to carry, ending a section. */
  sectionBreak?: string
}

/**
 * Flattens a list into the paragraphs OOXML actually stores.
 *
 * ProseMirror nests `bulletList > listItem > paragraph`; OOXML has none of
 * those. Every paragraph inside carries the same `w:numId`, and its depth
 * becomes `w:ilvl`.
 */
/** The numbering the first paragraph of a list arrived with, if it did. */
function firstItemNumbering(node: ProseMirrorNodeJson): { numId: number; level: number } | null {
  const paragraph = node.content?.[0]?.content?.[0]
  const numbering = paragraph?.attrs?.['numbering']
  if (typeof numbering !== 'object' || numbering === null) return null

  const { numId, level } = numbering as { numId?: number; level?: number }
  return typeof numId === 'number' ? { numId, level: typeof level === 'number' ? level : 0 } : null
}

function buildList(node: ProseMirrorNodeJson, context: BlockContext): XmlNode[] {
  const kind = node.type === 'orderedList' ? 'ordered' : 'bullet'

  // A list read from a file already points at a definition, and its paragraphs
  // still carry it. Reusing that leaves the document's own numbering alone;
  // allocating would add a second definition saying the same thing.
  const existing = firstItemNumbering(node)

  // A nested list keeps its parent's numbering: one definition per list, not
  // one per level, which is how Word writes them too.
  const numId = context.numbering?.numId ?? existing?.numId ?? context.allocateNumbering?.(kind)
  if (numId === undefined) {
    // No allocator — the caller is serialising without a package to add a
    // definition to. The text still survives, as plain paragraphs.
    return (node.content ?? []).flatMap((item) =>
      (item.content ?? []).flatMap((child) =>
        buildBlock(child, { ...context, numbering: undefined }),
      ),
    )
  }

  const level =
    context.numbering === undefined ? (existing?.level ?? 0) : context.numbering.level + 1

  return (node.content ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((child) =>
      buildBlock(child, { ...context, numbering: { numId, level } }),
    ),
  )
}

function buildBlock(node: ProseMirrorNodeJson, context: BlockContext): XmlNode[] {
  const alwaysPreserveSpace = context.alwaysPreserveSpace

  switch (node.type) {
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return buildList(node, context)

    case 'listItem':
    case 'taskItem':
      // Reached only when a list item holds another item directly.
      return (node.content ?? []).flatMap((child) => buildBlock(child, context))

    case 'paragraph':
    case 'heading': {
      const withNumbering =
        context.numbering === undefined
          ? node
          : { ...node, attrs: { ...node.attrs, numbering: context.numbering } }
      return [
        buildParagraph(
          withNumbering,
          alwaysPreserveSpace,
          context.captions?.get(node),
          context.sectionBreak,
        ),
      ]
    }

    case 'table':
      return [
        serializeTable(node, (cell) =>
          (cell.content ?? []).flatMap((child) =>
            // A table cell holds block content, so the same builder applies.
            buildBlock(child, { ...context, numbering: undefined }),
          ),
        ),
      ]

    case 'tableOfContents': {
      // Written as Word's own field rather than as our block, so "Update Table
      // of Contents" works and other editors show it as a table of contents
      // rather than as a run of ordinary paragraphs.
      const entries = node.attrs?.['entries']
      const maxLevel = numberAttr(node.attrs, 'maxLevel')
      const kind = captionKindOf(node.attrs?.['source'])

      return buildTocField(
        Array.isArray(entries) ? (entries as TocEntry[]) : [],
        maxLevel ?? 3,
        kind === undefined ? undefined : SEQUENCE_NAMES[kind],
      )
    }

    case 'passthroughBlock':
      return parsedNodes(stringAttr(node.attrs, 'xml'))

    case 'pageBreak':
      // A page break that ended up as its own block still needs a paragraph.
      return [element('w:p', {}, [element('w:r', {}, [buildBreak(node)])])]

    default:
      // Unknown block types are dropped rather than guessed at; the parser only
      // ever produces the types above.
      return []
  }
}

export function serializeDocument(doc: ProseMirrorNodeJson, options: SerializeOptions): string {
  // Counted over the whole body before anything is written: a caption's number
  // depends on every block above it, which the block itself cannot see.
  const blocks = doc.content ?? []
  const captions = new Map<ProseMirrorNodeJson, CaptionNumber>()

  for (const numbered of numberCaptions(
    blocks.map((node) => ({
      type: node.type,
      level: numberAttr(node.attrs, 'level') ?? undefined,
      captionKind: captionKindOf(node.attrs?.['captionKind']),
    })),
    options.captionsByChapter ?? false,
  )) {
    const block = blocks[numbered.index]
    if (block !== undefined) captions.set(block, numbered)
  }

  const context: BlockContext = {
    alwaysPreserveSpace: options.alwaysPreserveSpace ?? false,
    captions,
    ...(options.allocateNumbering ? { allocateNumbering: options.allocateNumbering } : {}),
  }

  const body: XmlNode[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const node = blocks[index]
    if (node === undefined || node.type === 'sectionBreak') continue

    // A section's properties live on the last paragraph of that section, so a
    // break is folded into the block in front of it rather than written out.
    const next = blocks[index + 1]
    const sectPr =
      next?.type === 'sectionBreak' && (node.type === 'paragraph' || node.type === 'heading')
        ? stringAttr(next.attrs, 'sectPr')
        : null

    body.push(...buildBlock(node, { ...context, ...(sectPr === null ? {} : { sectionBreak: sectPr }) }))

    // Nothing in front of it that can carry the properties — a table, or the
    // very start of the document — so the break needs a paragraph of its own.
    const orphan = blocks[index + 1]
    if (orphan?.type === 'sectionBreak' && sectPr === null) {
      body.push(element('w:p', {}, [element('w:pPr', {}, parsedNodes(stringAttr(orphan.attrs, 'sectPr')))]))
    }
  }

  // A break with nothing before it at all still ends a section.
  if (blocks[0]?.type === 'sectionBreak') {
    body.unshift(
      element('w:p', {}, [element('w:pPr', {}, parsedNodes(stringAttr(blocks[0].attrs, 'sectPr')))]),
    )
  }
  body.push(...parsedNodes(options.sectionProperties))

  const document = element('w:document', options.documentAttributes, [element('w:body', {}, body)])

  return withDeclaration(buildXml([document]))
}

/** Convenience for the common case of serialising what `parseDocument` produced. */
export function serializeParsed(parsed: ParsedDocument): string {
  return serializeDocument(parsed.doc, {
    documentAttributes: parsed.documentAttributes,
    sectionProperties: parsed.sectionProperties,
    alwaysPreserveSpace: parsed.alwaysPreserveSpace,
  })
}
