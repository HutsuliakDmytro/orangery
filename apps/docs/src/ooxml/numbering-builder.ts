import {
  preservingRoot,
  children,
  element,
  parseXml,
  pointsToTwips,
  serializeNode,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { NumberingCatalogue } from './numbering'
import { nextAbstractNumId, nextNumId } from './numbering'

/**
 * Creating numbering definitions for lists made in the editor.
 *
 * A `w:numPr` that points at a numId the file does not define renders as
 * unindented body text in Word — the list looks fine here and arrives as a
 * wall of paragraphs. So a list created in the editor has to bring its
 * definition with it.
 */

export const NUMBERING_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'
export const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'

export type ListKind = 'bullet' | 'ordered'

/** Word's own defaults: half an inch per level, hanging by a quarter. */
const INDENT_STEP_PT = 36
const HANGING_PT = 18

const BULLET_GLYPHS = ['•', 'o', '▪']
const BULLET_FONTS = ['Symbol', 'Courier New', 'Wingdings']
const ORDERED_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman']

/** Nine levels, which is what Word writes and the maximum OOXML allows. */
export function buildAbstractNum(id: number, kind: ListKind): XmlNode {
  const levels = Array.from({ length: 9 }, (_, level) => {
    const indent = INDENT_STEP_PT * (level + 1)
    const cycle = level % 3

    return element('w:lvl', { 'w:ilvl': String(level) }, [
      element('w:start', { 'w:val': '1' }),
      element('w:numFmt', {
        'w:val': kind === 'bullet' ? 'bullet' : (ORDERED_FORMATS[cycle] ?? 'decimal'),
      }),
      element('w:lvlText', {
        'w:val': kind === 'bullet' ? (BULLET_GLYPHS[cycle] ?? '•') : `%${String(level + 1)}.`,
      }),
      element('w:lvlJc', { 'w:val': 'left' }),
      element('w:pPr', {}, [
        element('w:ind', {
          'w:left': String(pointsToTwips(indent)),
          'w:hanging': String(pointsToTwips(HANGING_PT)),
        }),
      ]),
      ...(kind === 'bullet'
        ? [
            element('w:rPr', {}, [
              element('w:rFonts', {
                'w:ascii': BULLET_FONTS[cycle] ?? 'Symbol',
                'w:hAnsi': BULLET_FONTS[cycle] ?? 'Symbol',
                'w:hint': 'default',
              }),
            ]),
          ]
        : []),
    ])
  })

  return element('w:abstractNum', { 'w:abstractNumId': String(id) }, [
    element('w:multiLevelType', { 'w:val': 'hybridMultilevel' }),
    ...levels,
  ])
}

export function buildNum(numId: number, abstractNumId: number): XmlNode {
  return element('w:num', { 'w:numId': String(numId) }, [
    element('w:abstractNumId', { 'w:val': String(abstractNumId) }),
  ])
}

export interface AllocatedNumbering {
  numId: number
  /** XML to add to `numbering.xml`: the definition and its instance. */
  nodes: XmlNode[]
}

/**
 * Reserves a numId for a new list and produces its definition.
 *
 * The catalogue is updated so a second call in the same save does not hand out
 * the same id twice.
 */
export function allocateNumbering(
  catalogue: NumberingCatalogue,
  kind: ListKind,
): AllocatedNumbering {
  const abstractNumId = nextAbstractNumId(catalogue)
  const numId = nextNumId(catalogue)

  // Recorded immediately so the next allocation sees them as taken.
  catalogue.abstract.set(abstractNumId, { id: abstractNumId, levels: new Map() })
  catalogue.instances.set(numId, { numId, abstractNumId, overrides: new Map() })

  return {
    numId,
    nodes: [buildAbstractNum(abstractNumId, kind), buildNum(numId, abstractNumId)],
  }
}

/**
 * Merges new definitions into an existing `numbering.xml`, or builds one.
 *
 * `w:abstractNum` elements must all precede `w:num` elements, which is why the
 * two are separated rather than appended in allocation order.
 */
export function mergeNumbering(existingXml: string | undefined, added: readonly XmlNode[]): string {
  const abstractAdded = added.filter((node) => tagName(node) === 'w:abstractNum')
  const numsAdded = added.filter((node) => tagName(node) === 'w:num')

  const root =
    existingXml === undefined
      ? undefined
      : parseXml(existingXml).find((node) => tagName(node) === 'w:numbering')

  const existing = root ? children(root) : []
  const abstract = existing.filter((node) => tagName(node) === 'w:abstractNum')
  const nums = existing.filter((node) => tagName(node) === 'w:num')
  const other = existing.filter(
    (node) => tagName(node) !== 'w:abstractNum' && tagName(node) !== 'w:num',
  )

  const attributes =
    root && typeof root[':@'] === 'object' && root[':@'] !== null
      ? Object.fromEntries(
          Object.entries(root[':@'] as Record<string, unknown>).map(([key, value]) => [
            key.replace(/^@_/u, ''),
            String(value),
          ]),
        )
      : {
          'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        }

  return preservingRoot(existingXml, [
    element('w:numbering', attributes, [
      ...other,
      ...abstract,
      ...abstractAdded,
      ...nums,
      ...numsAdded,
    ]),
  ])
}

/** Serialised form of a definition, for storing on a list node. */
export function definitionXml(nodes: readonly XmlNode[]): string {
  return nodes.map(serializeNode).join('')
}
