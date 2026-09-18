import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'

/**
 * `p:timing` — what happens on a slide, and when.
 *
 * The markup is deeper than what it describes. A single fade is six nested
 * `p:par` nodes, most of which exist to hold a condition list; the shape of it
 * comes from SMIL, which PowerPoint borrowed and then only ever writes one way.
 * So this reads for the shape PowerPoint writes rather than for everything SMIL
 * allows: the main sequence, the click steps under it, and the effects in each.
 *
 * What is read is enough to play a slide. It is not enough to rebuild one — and
 * nothing here writes, so the timing of a deck we open is the timing of the
 * deck we save (ADR 0002).
 */

/** What an effect does to the shape it is aimed at. */
export type EffectKind = 'entrance' | 'exit' | 'emphasis' | 'motion' | 'other'

const KINDS: Readonly<Record<string, EffectKind>> = {
  entr: 'entrance',
  exit: 'exit',
  emph: 'emphasis',
  path: 'motion',
  verb: 'other',
  mediacall: 'other',
}

/** When an effect starts, relative to the one before it. */
export type Trigger = 'click' | 'with' | 'after'

const TRIGGERS: Readonly<Record<string, Trigger>> = {
  clickEffect: 'click',
  withEffect: 'with',
  afterEffect: 'after',
}

export interface Effect {
  /**
   * `p:cTn/@id` of the effect node — its name in the file.
   *
   * What an editor holds on to. A position in a list changes when anything
   * before it does; this does not, which is what makes "change that one"
   * mean the same thing after the list has been rearranged.
   */
  id: number
  /** The shape it is aimed at; null for an effect aimed at something else. */
  shapeId: number | null
  kind: EffectKind
  /** `presetID` — which of PowerPoint's effects it is, within its class. */
  preset: number | null
  /** `presetSubtype`, which for most entrances is the direction. */
  subtype: number | null
  trigger: Trigger
  /** Milliseconds; null where the file states none and a default applies. */
  duration: number | null
  delay: number
  /** `fade`, `wipe`, `blinds`, … from `p:animEffect`, when there is one. */
  filter: string | null
}

/**
 * One press of the space bar.
 *
 * The first effect of a step is the one that waited for the click; everything
 * after it runs with or after that one, which is why a step is a list rather
 * than a single effect.
 */
export interface AnimationStep {
  effects: Effect[]
}

const numberOr = (value: string | undefined, fallback: number | null): number | null => {
  if (value === undefined) return fallback
  // `indefinite` is a real value and not a number: it means "until something
  // else says", which for a duration is not a length at all.
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** The `p:cTn` of a node, which is where everything about it is stated. */
const timingOf = (node: XmlNode): XmlNode | undefined => findChild(node, 'p:cTn')

/** The first `delay` in a condition list, which is when the node starts. */
function delayOf(timing: XmlNode | undefined): number {
  const list = timing === undefined ? undefined : findChild(timing, 'p:stCondLst')
  const condition = list === undefined ? undefined : findChild(list, 'p:cond')
  return numberOr(condition === undefined ? undefined : attribute(condition, 'delay'), 0) ?? 0
}

/**
 * Every descendant with a given tag, however deep.
 *
 * A match is looked inside as well as returned. `p:cTn` nests within `p:cTn`
 * all the way down — the root, the sequence, the step, the effect — so a search
 * that stopped at the first one would never reach the sequence at all.
 */
function descendants(node: XmlNode, tag: string): XmlNode[] {
  return children(node).flatMap((child) => [
    ...(tagName(child) === tag ? [child] : []),
    ...descendants(child, tag),
  ])
}

/** The shape an effect is aimed at, from the first `p:spTgt` under it. */
function targetOf(node: XmlNode): number | null {
  const target = descendants(node, 'p:spTgt')[0]
  const id = target === undefined ? undefined : attribute(target, 'spid')
  return numberOr(id, null)
}

/**
 * How long the effect runs.
 *
 * Not from the effect's own `p:cTn`, which usually says nothing: the length is
 * on the behaviour inside it, and a `p:set` that flips visibility for one
 * millisecond sits beside the `p:animEffect` that does the visible work. The
 * longest of them is how long the effect takes.
 */
function durationOf(node: XmlNode): number | null {
  const stated = descendants(node, 'p:cTn')
    .map((timing) => numberOr(attribute(timing, 'dur'), null))
    .filter((value): value is number => value !== null && value > 1)

  return stated.length === 0 ? null : Math.max(...stated)
}

function readEffect(node: XmlNode, trigger: Trigger): Effect {
  const timing = timingOf(node)
  const animEffect = descendants(node, 'p:animEffect')[0]

  return {
    id: numberOr(attribute(timing ?? {}, 'id'), -1) ?? -1,
    shapeId: targetOf(node),
    kind: KINDS[attribute(timing ?? {}, 'presetClass') ?? ''] ?? 'other',
    preset: numberOr(attribute(timing ?? {}, 'presetID'), null),
    subtype: numberOr(attribute(timing ?? {}, 'presetSubtype'), null),
    trigger,
    duration: durationOf(node),
    delay: delayOf(timing),
    filter: animEffect === undefined ? null : (attribute(animEffect, 'filter') ?? null),
  }
}

/** The nodes that carry a `nodeType` saying how they start: the effects themselves. */
function effectsIn(node: XmlNode): Effect[] {
  return children(node).flatMap((child): Effect[] => {
    const timing = timingOf(child)
    const trigger = TRIGGERS[attribute(timing ?? {}, 'nodeType') ?? '']

    if (trigger !== undefined) return [readEffect(child, trigger)]

    const inner = timing === undefined ? undefined : findChild(timing, 'p:childTnLst')
    return inner === undefined ? [] : effectsIn(inner)
  })
}

/** The main sequence, which is the one a click advances. */
function mainSequence(root: XmlNode): XmlNode | undefined {
  return descendants(root, 'p:cTn').find((timing) => attribute(timing, 'nodeType') === 'mainSeq')
}

/**
 * The steps a slide plays, in order.
 *
 * Each step is one press. An effect that starts on a click begins a new one;
 * the ones that start with or after it join the step already open — which is
 * the whole of what those three words mean.
 */
export function readAnimations(slide: SlidePart): AnimationStep[] {
  const timing = findChild(slide.root, 'p:timing')
  if (timing === undefined) return []

  const sequence = mainSequence(timing)
  const list = sequence === undefined ? undefined : findChild(sequence, 'p:childTnLst')
  if (list === undefined) return []

  const effects = children(list).flatMap((child) => {
    const inner = timingOf(child)
    const childList = inner === undefined ? undefined : findChild(inner, 'p:childTnLst')
    return childList === undefined ? [] : effectsIn(childList)
  })

  const steps: AnimationStep[] = []
  for (const effect of effects) {
    const open = steps[steps.length - 1]
    // A slide whose first effect says "with previous" has nothing to be with,
    // so it starts a step of its own rather than being dropped.
    if (effect.trigger === 'click' || open === undefined) steps.push({ effects: [effect] })
    else open.effects.push(effect)
  }

  return steps
}

/** Every shape that is not on the slide until an entrance brings it in. */
export function hiddenUntilAnimated(steps: readonly AnimationStep[]): Set<number> {
  const hidden = new Set<number>()
  const seen = new Set<number>()

  for (const step of steps) {
    for (const effect of step.effects) {
      if (effect.shapeId === null) continue
      // Only the first effect on a shape decides: one that is emphasised and
      // then made to leave was on the slide from the start.
      if (!seen.has(effect.shapeId) && effect.kind === 'entrance') hidden.add(effect.shapeId)
      seen.add(effect.shapeId)
    }
  }

  return hidden
}
