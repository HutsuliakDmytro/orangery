import type { CSSProperties } from 'react'
import type { Transition } from '@orangery/ooxml-presentation'

/**
 * A transition as two sets of CSS: one for the slide arriving, one for the
 * slide leaving.
 *
 * Kept apart from the component so the mapping can be read and tested on its
 * own: which way a push travels and which edge a wipe starts from are the two
 * things easiest to get backwards, and neither is visible in jsdom.
 *
 * The animations are named in `styles/global.css` and take their distances from
 * custom properties, so there is one keyframe per shape of movement rather than
 * one per direction.
 */

/** Where the arriving slide starts, for a push. */
const ARRIVES_FROM: Record<string, [string, string]> = {
  // `dir` is the way the content travels, so the new slide comes from the
  // opposite edge: a push upwards brings the next slide up from below.
  u: ['0', '100%'],
  d: ['0', '-100%'],
  l: ['100%', '0'],
  r: ['-100%', '0'],
}

/** Where the leaving slide goes, which is the way the content travels. */
const LEAVES_TO: Record<string, [string, string]> = {
  u: ['0', '-100%'],
  d: ['0', '100%'],
  l: ['-100%', '0'],
  r: ['100%', '0'],
}

/**
 * How much of the arriving slide is hidden at the start of a wipe.
 *
 * `inset` counts from the top, right, bottom and left. A wipe to the right
 * uncovers from the left edge, so everything to the right of it starts hidden.
 */
const WIPE_FROM: Record<string, string> = {
  r: 'inset(0 100% 0 0)',
  l: 'inset(0 0 0 100%)',
  d: 'inset(0 0 100% 0)',
  u: 'inset(100% 0 0 0)',
}

export interface TransitionStyles {
  arriving: CSSProperties
  /** Null when the slide leaving does not move, which is most of them. */
  leaving: CSSProperties | null
}

/** The default direction where a file states a push or a wipe without one. */
const DEFAULT_DIRECTION = 'l'

export function transitionStyles(transition: Transition): TransitionStyles {
  const seconds = `${String(transition.duration / 1000)}s`
  const direction = transition.direction ?? DEFAULT_DIRECTION

  if (transition.kind === 'push') {
    const [fromX, fromY] = ARRIVES_FROM[direction] ?? ARRIVES_FROM[DEFAULT_DIRECTION] ?? ['0', '0']
    const [toX, toY] = LEAVES_TO[direction] ?? LEAVES_TO[DEFAULT_DIRECTION] ?? ['0', '0']

    return {
      arriving: {
        animation: `orangery-slide-in ${seconds} ease-out both`,
        ['--orangery-from-x' as string]: fromX,
        ['--orangery-from-y' as string]: fromY,
      },
      leaving: {
        animation: `orangery-slide-out ${seconds} ease-out both`,
        ['--orangery-to-x' as string]: toX,
        ['--orangery-to-y' as string]: toY,
      },
    }
  }

  if (transition.kind === 'wipe') {
    return {
      arriving: {
        animation: `orangery-wipe-in ${seconds} ease-out both`,
        ['--orangery-clip' as string]: WIPE_FROM[direction] ?? WIPE_FROM[DEFAULT_DIRECTION] ?? '',
      },
      // The old slide stays where it is and is uncovered from over it.
      leaving: null,
    }
  }

  // Everything else is a fade, including everything we cannot draw.
  return { arriving: { animation: `orangery-fade-in ${seconds} ease-out both` }, leaving: null }
}
