import {
  attribute,
  children,
  element,
  parseIntAttribute,
  pointsToTwips,
  tagName,
  twipsToPoints,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * Tab stops — `w:pPr/w:tabs`.
 *
 * A tab stop says where a tab character lands and what fills the gap it leaves.
 * The dotted leader is what makes a hand-written table of contents line up, and
 * a document whose stops are dropped loses its alignment entirely while still
 * looking like it has tabs in it.
 */

export type TabAlignment = 'left' | 'center' | 'right' | 'decimal' | 'bar'
export type TabLeader = 'none' | 'dot' | 'hyphen' | 'underscore' | 'middleDot'

export interface TabStop {
  /** Distance from the left margin, in points. */
  position: number
  alignment: TabAlignment
  leader: TabLeader
}

const ALIGNMENTS = new Set<string>(['left', 'center', 'right', 'decimal', 'bar'])
const LEADERS = new Set<string>(['none', 'dot', 'hyphen', 'underscore', 'middleDot'])

/**
 * `w:clear` removes a stop inherited from the style rather than adding one.
 *
 * It is kept out of the model: the editor has no style-inherited stops to
 * cancel, and a cleared stop written back as a real one would put a tab where
 * the document says there is none.
 */
const CLEAR = 'clear'

export function parseTabs(tabs: XmlNode | undefined): TabStop[] {
  if (!tabs) return []

  const stops: TabStop[] = []

  for (const child of children(tabs)) {
    if (tagName(child) !== 'w:tab') continue

    const alignment = attribute(child, 'w:val') ?? 'left'
    if (alignment === CLEAR) continue

    const position = parseIntAttribute(attribute(child, 'w:pos'))
    if (position === null) continue

    const leader = attribute(child, 'w:leader') ?? 'none'

    stops.push({
      position: twipsToPoints(position),
      alignment: ALIGNMENTS.has(alignment) ? (alignment as TabAlignment) : 'left',
      leader: LEADERS.has(leader) ? (leader as TabLeader) : 'none',
    })
  }

  // Word keeps them in order and so must we: a tab lands at the next stop to
  // the right of where it starts, which is only meaningful if they are sorted.
  return stops.sort((left, right) => left.position - right.position)
}

export function serializeTabs(stops: readonly TabStop[]): XmlNode | null {
  if (stops.length === 0) return null

  return element(
    'w:tabs',
    {},
    stops.map((stop) =>
      element('w:tab', {
        'w:val': stop.alignment,
        ...(stop.leader === 'none' ? {} : { 'w:leader': stop.leader }),
        'w:pos': String(pointsToTwips(stop.position)),
      }),
    ),
  )
}

/** Adds a stop, replacing one already at that position. */
export function withStop(stops: readonly TabStop[], stop: TabStop): TabStop[] {
  return [...stops.filter((existing) => !samePosition(existing, stop)), stop].sort(
    (left, right) => left.position - right.position,
  )
}

export function withoutStop(stops: readonly TabStop[], position: number): TabStop[] {
  return stops.filter((stop) => !samePosition(stop, { position }))
}

/** Within a quarter of a point, which is finer than a stop can be dragged. */
function samePosition(left: { position: number }, right: { position: number }): boolean {
  return Math.abs(left.position - right.position) < 0.25
}

/** Where a tab starting at `from` lands, or null when no stop is to its right. */
export function nextStop(stops: readonly TabStop[], from: number): TabStop | null {
  return stops.find((stop) => stop.position > from + 0.25) ?? null
}

/**
 * Word's own default stops, used where a paragraph declares none of its own.
 *
 * `w:defaultTabStop` in settings.xml states the interval; half an inch is what
 * Word writes when nothing says otherwise.
 */
export const DEFAULT_TAB_INTERVAL_PT = 36

export function defaultStopAfter(from: number, interval = DEFAULT_TAB_INTERVAL_PT): number {
  return (Math.floor(from / interval) + 1) * interval
}
