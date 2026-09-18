import type { AnimationStep, Effect, SlidePart } from '@orangery/ooxml-presentation'
import { hiddenUntilAnimated, readAnimations } from '@orangery/ooxml-presentation'
import type { CSSProperties } from 'react'

/**
 * What a slide looks like part-way through its animations.
 *
 * A slide with animations is not one picture but several, and which one is
 * showing is a number: how many times the presenter has pressed. Everything
 * else follows from that — which shapes are on the slide, and which one is
 * moving at this moment.
 *
 * Effects we do not model play as a fade, which is the rule the transitions
 * already follow. A shape that appeared when it should have flown in is a
 * slide that reads correctly; a shape that did not appear at all is not.
 */

export interface SlideAnimation {
  /** Shapes not on the slide yet, or no longer on it. */
  hidden: ReadonlySet<number>
  /** The shapes moving right now, and what they are doing. */
  playing: ReadonlyMap<number, Effect>
  /**
   * Which press this is, so the renderer can tell one from the next.
   *
   * An animation runs when the element carrying it is new. Keying on the step
   * is what makes it run once per press rather than on every re-render, and
   * what makes the next press run it again.
   */
  step: number
}

export const STILL: SlideAnimation = { hidden: new Set(), playing: new Map(), step: 0 }

/**
 * The slide after `shown` presses.
 *
 * Zero is the slide as the room first sees it: everything that has an entrance
 * is still off it. Every press plays one step, and a step already played is a
 * step whose effects have simply happened.
 */
export function animationAt(steps: readonly AnimationStep[], shown: number): SlideAnimation {
  if (steps.length === 0) return STILL

  const hidden = new Set(hiddenUntilAnimated(steps))
  const played = Math.min(Math.max(shown, 0), steps.length)

  for (let index = 0; index < played; index += 1) {
    for (const effect of steps[index]?.effects ?? []) {
      if (effect.shapeId === null) continue
      if (effect.kind === 'entrance') hidden.delete(effect.shapeId)
      if (effect.kind === 'exit') hidden.add(effect.shapeId)
    }
  }

  // The last step played is the one happening now. Nothing remembers that it
  // has finished: the animation runs once because the element it is on is new,
  // and a re-render with the same count draws the same element again.
  const playing = new Map<number, Effect>()
  for (const effect of (played === 0 ? undefined : steps[played - 1])?.effects ?? []) {
    if (effect.shapeId !== null) playing.set(effect.shapeId, effect)
  }

  return { hidden, playing, step: played }
}

/** PowerPoint's own default, for an effect that states no length. */
const DEFAULT_DURATION = 500

/** Which way a fly-in comes from, by the subtype the file states. */
const DIRECTIONS: Readonly<Record<number, string>> = {
  1: 'from-top',
  2: 'from-right',
  4: 'from-bottom',
  8: 'from-left',
  3: 'from-top-right',
  6: 'from-bottom-right',
  9: 'from-top-left',
  12: 'from-bottom-left',
}

/** The keyframes each kind of effect uses, by the name in `global.css`. */
function keyframesFor(effect: Effect): string {
  if (effect.kind === 'emphasis') return 'orangery-pulse'

  const leaving = effect.kind === 'exit'
  const filter = effect.filter ?? ''

  // Fly in is a preset rather than a filter: it is stated as a motion, and the
  // direction is in the subtype.
  if (effect.preset === 2 && !leaving) {
    return `orangery-fly-${DIRECTIONS[effect.subtype ?? 8] ?? 'from-left'}`
  }

  if (/^wipe/u.test(filter)) return leaving ? 'orangery-wipe-out' : 'orangery-wipe-in'
  if (/zoom|circle|box/u.test(filter)) return leaving ? 'orangery-zoom-out' : 'orangery-zoom-in'

  // Everything else fades, which is what an effect nobody modelled should do.
  return leaving ? 'orangery-fade-out' : 'orangery-fade-in'
}

/**
 * The CSS that plays one effect.
 *
 * `both` so the shape holds the state the effect left it in: an exit that
 * snapped back to visible on its last frame would be an exit that did nothing.
 */
export function effectStyle(effect: Effect): CSSProperties {
  const duration = effect.duration ?? DEFAULT_DURATION

  return {
    animationName: keyframesFor(effect),
    animationDuration: `${String(duration)}ms`,
    animationDelay: `${String(effect.delay)}ms`,
    animationFillMode: 'both',
    animationTimingFunction: 'ease-out',
    transformOrigin: 'center',
  }
}

/** How many presses each slide of a deck takes before the next one. */
export function stepsPerSlide(deck: { slides: readonly SlidePart[] }): number[] {
  return deck.slides.map((slide) => readAnimations(slide).length)
}
