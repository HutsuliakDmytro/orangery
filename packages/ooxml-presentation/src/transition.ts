import { attribute, children, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'

/**
 * How one slide gives way to the next.
 *
 * The format names some forty of these and we can draw four. The rest are not
 * "no transition": something was meant to happen between the slides, and a
 * checkerboard nobody asked for is closer to a fade than to a cut. So anything
 * we cannot draw becomes a fade, the file keeps whatever it said, and a deck
 * that goes back to PowerPoint still dissolves.
 *
 * The duration is the one number that is not in the original schema. PowerPoint
 * 2010 added `p14:dur` in milliseconds, usually inside `mc:AlternateContent`
 * with a `spd` in the fallback; `spd` is three words rather than a number, so
 * the milliseconds win where they exist.
 */

export type TransitionKind = 'none' | 'fade' | 'push' | 'wipe' | 'morph'

/** `l`, `r`, `u`, `d` — which way a push or a wipe travels. */
export type TransitionDirection = 'l' | 'r' | 'u' | 'd'

export interface Transition {
  kind: TransitionKind
  /** Milliseconds. */
  duration: number
  /** Null for a kind that does not travel. */
  direction: TransitionDirection | null
  /** What the file actually said, for anyone tracing why it looks like a fade. */
  stated: string
}

/** PowerPoint's own three speeds, as the milliseconds it uses for them. */
const SPEEDS: Record<string, number> = { slow: 1000, med: 750, fast: 500 }

const DEFAULT_DURATION = SPEEDS['med'] ?? 750

const DRAWN: Record<string, TransitionKind> = {
  'p:fade': 'fade',
  'p:push': 'push',
  'p:wipe': 'wipe',
  'p:cut': 'none',
}

/** The local name, for the effects whose prefix is not `p`. */
const localName = (tag: string): string => tag.replace(/^[^:]*:/u, '')

const DIRECTIONS = new Set(['l', 'r', 'u', 'd'])

/**
 * Finds `p:transition`, inside a compatibility wrapper or not.
 *
 * `mc:AlternateContent` is how a file offers a newer reading and an older one.
 * The choice is the newer, and it is the one with the duration in it.
 */
function transitionNode(part: SlidePart): XmlNode | undefined {
  for (const child of children(part.root)) {
    if (tagName(child) === 'p:transition') return child
    if (tagName(child) !== 'mc:AlternateContent') continue

    for (const branch of children(child)) {
      if (tagName(branch) !== 'mc:Choice' && tagName(branch) !== 'mc:Fallback') continue

      const found = children(branch).find((one) => tagName(one) === 'p:transition')
      if (found !== undefined) return found
    }
  }

  return undefined
}

/** Reads the transition of a slide, or null when it states none. */
export function readTransition(part: SlidePart): Transition | null {
  const node = transitionNode(part)
  if (node === undefined) return null

  // Morph arrived after the original schema and carries whichever prefix the
  // version that wrote it used, so it is found by its local name; everything
  // older is `p:` and is left matched the way it always was.
  const effect = children(node).find((child) => {
    const tag = tagName(child) ?? ''
    return tag.startsWith('p:') || localName(tag) === 'morph'
  })
  const stated = effect === undefined ? '' : localName(tagName(effect) ?? '')

  const milliseconds = Number(attribute(node, 'p14:dur'))
  const duration = Number.isFinite(milliseconds)
    ? Math.max(milliseconds, 0)
    : (SPEEDS[attribute(node, 'spd') ?? ''] ?? DEFAULT_DURATION)

  if (effect === undefined) return { kind: 'fade', duration, direction: null, stated }

  // Anything we cannot draw is a fade: something was meant to happen here.
  const kind =
    localName(tagName(effect) ?? '') === 'morph'
      ? 'morph'
      : (DRAWN[tagName(effect) ?? ''] ?? 'fade')
  const direction = attribute(effect, 'dir') ?? ''

  return {
    kind,
    duration: kind === 'none' ? 0 : duration,
    direction:
      (kind === 'push' || kind === 'wipe') && DIRECTIONS.has(direction)
        ? (direction as TransitionDirection)
        : null,
    stated,
  }
}
