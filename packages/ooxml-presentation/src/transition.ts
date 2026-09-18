import {
  attribute,
  children,
  element,
  removeAttribute,
  setAttribute,
  tagName,
} from '@orangery/ooxml-core'
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
  /**
   * `advTm` — how long the slide stays up before the show moves on by itself.
   *
   * Null where the slide waits for a press, which is almost every slide. This
   * is what rehearsing writes down, and a slide can carry one with no visual
   * transition at all.
   */
  advanceAfter: number | null
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

  const advance = Number(attribute(node, 'advTm'))
  const advanceAfter = Number.isFinite(advance) && advance >= 0 ? advance : null

  // A `p:transition` with no effect in it states no effect. It is not something
  // we cannot draw — it is a slide that carries a timing and nothing else,
  // which is what rehearsing leaves behind, and fading it would invent a
  // transition the file never asked for.
  if (effect === undefined) {
    return { kind: 'none', duration: 0, direction: null, advanceAfter, stated }
  }

  // Anything we cannot draw is a fade: something was meant to happen here.
  const kind =
    localName(tagName(effect) ?? '') === 'morph'
      ? 'morph'
      : (DRAWN[tagName(effect) ?? ''] ?? 'fade')
  const direction = attribute(effect, 'dir') ?? ''

  return {
    kind,
    duration: kind === 'none' ? 0 : duration,
    advanceAfter,
    direction:
      (kind === 'push' || kind === 'wipe') && DIRECTIONS.has(direction)
        ? (direction as TransitionDirection)
        : null,
    stated,
  }
}

/** `p:sld` in schema order, for putting a transition where it belongs. */
const SLIDE_ORDER = ['p:cSld', 'p:clrMapOvr', 'p:transition', 'p:timing']

/**
 * Writes down how long a slide was up, which is what rehearsing produces.
 *
 * Only the timing: a slide that had no transition still has none afterwards.
 * Rehearsing measures how long somebody talked, and a deck that started
 * dissolving because it was rehearsed would be a deck changed by being
 * practised.
 *
 * Null takes the timing off again, and takes the element with it when that is
 * all it carried.
 */
export function setAdvanceTime(part: SlidePart, milliseconds: number | null): boolean {
  const existing = transitionNode(part)

  if (milliseconds === null) {
    if (existing === undefined) return false

    removeAttribute(existing, 'advTm')
    if (children(existing).length === 0) {
      const nodes = children(part.root)
      const at = nodes.indexOf(existing)
      if (at !== -1) nodes.splice(at, 1)
    }
    return true
  }

  const wanted = String(Math.max(Math.round(milliseconds), 0))
  if (existing !== undefined) {
    if (attribute(existing, 'advTm') === wanted) return false
    setAttribute(existing, 'advTm', wanted)
    return true
  }

  const made = element('p:transition', { advTm: wanted })
  const nodes = children(part.root)
  const at = nodes.findIndex((node) => SLIDE_ORDER.indexOf(tagName(node) ?? '') > 2)
  if (at === -1) nodes.push(made)
  else nodes.splice(at, 0, made)

  return true
}
