import {
  attribute,
  children,
  element,
  findChild,
  setAttribute,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'
import type { EffectKind, Trigger } from './animations'

/**
 * Changing what a slide plays.
 *
 * Nothing here rebuilds `p:timing`. Effects are added as new subtrees, removed
 * by dropping their node, and changed by patching attributes on the node that
 * is already there — so an effect this app cannot describe survives being
 * beside one it can (ADR 0002).
 *
 * The catalogue is small on purpose. A fly-in is stated as motion on the
 * shape's own position, and writing one means writing coordinates nobody here
 * has measured; reading a deck that has one still works, and offering to make
 * one we would get wrong does not. What is offered is what can be written
 * exactly: appear, fade, wipe, zoom, and a pulse.
 */

/** The effects this app can write, by the name a person picks them by. */
export type EffectName = 'appear' | 'fade' | 'wipe' | 'zoom' | 'pulse'

interface Recipe {
  kind: EffectKind
  presetId: number
  /** `p:animEffect/@filter`; null for an effect that only changes visibility. */
  filter: string | null
}

const ENTRANCES: Readonly<Record<string, Recipe>> = {
  appear: { kind: 'entrance', presetId: 1, filter: null },
  fade: { kind: 'entrance', presetId: 10, filter: 'fade' },
  wipe: { kind: 'entrance', presetId: 22, filter: 'wipe(up)' },
  zoom: { kind: 'entrance', presetId: 23, filter: 'zoom' },
}

const EXITS: Readonly<Record<string, Recipe>> = {
  appear: { kind: 'exit', presetId: 1, filter: null },
  fade: { kind: 'exit', presetId: 10, filter: 'fade' },
  wipe: { kind: 'exit', presetId: 22, filter: 'wipe(down)' },
  zoom: { kind: 'exit', presetId: 23, filter: 'zoom' },
}

const PULSE: Recipe = { kind: 'emphasis', presetId: 1, filter: null }

const CLASSES: Readonly<Record<EffectKind, string>> = {
  entrance: 'entr',
  exit: 'exit',
  emphasis: 'emph',
  motion: 'path',
  other: 'verb',
}

const NODE_TYPES: Readonly<Record<Trigger, string>> = {
  click: 'clickEffect',
  with: 'withEffect',
  after: 'afterEffect',
}

export interface NewEffect {
  shapeId: number
  name: EffectName
  /** An entrance brings the shape on; an exit takes it off. */
  kind: 'entrance' | 'exit' | 'emphasis'
  trigger: Trigger
  /** Milliseconds. */
  duration?: number
  delay?: number
}

/** Every `p:cTn` in the timing, so a new one can be given an id nobody has. */
function allTimings(node: XmlNode): XmlNode[] {
  return children(node).flatMap((child) => [
    ...(tagName(child) === 'p:cTn' ? [child] : []),
    ...allTimings(child),
  ])
}

function nextId(timing: XmlNode): number {
  const used = allTimings(timing).map((node) => Number(attribute(node, 'id')))
  return Math.max(0, ...used.filter((id) => Number.isFinite(id))) + 1
}

/** The scaffold PowerPoint writes around every main sequence. */
function emptyTiming(): XmlNode {
  return element('p:timing', {}, [
    element('p:tnLst', {}, [
      element('p:par', {}, [
        element('p:cTn', { id: '1', dur: 'indefinite', restart: 'never', nodeType: 'tmRoot' }, [
          element('p:childTnLst', {}, [
            element('p:seq', { concurrent: '1', nextAc: 'seek' }, [
              element('p:cTn', { id: '2', dur: 'indefinite', nodeType: 'mainSeq' }, [
                element('p:childTnLst'),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ])
}

/** `p:sld` in schema order, for putting the timing back where it belongs. */
const SLIDE_ORDER = ['p:cSld', 'p:clrMapOvr', 'p:transition', 'p:timing']

function timingOf(slide: SlidePart, make: boolean): XmlNode | undefined {
  const existing = findChild(slide.root, 'p:timing')
  if (existing !== undefined || !make) return existing

  const made = emptyTiming()
  const nodes = children(slide.root)
  // After the transition, before nothing: it is the last thing a slide holds.
  const at = nodes.findIndex((node) => SLIDE_ORDER.indexOf(tagName(node) ?? '') > 3)
  if (at === -1) nodes.push(made)
  else nodes.splice(at, 0, made)

  return made
}

/** The `p:childTnLst` of the main sequence, which is where the steps live. */
function mainList(timing: XmlNode): XmlNode | undefined {
  const sequence = allTimings(timing).find((node) => attribute(node, 'nodeType') === 'mainSeq')
  return sequence === undefined ? undefined : findChild(sequence, 'p:childTnLst')
}

const condition = (delay: string) => element('p:stCondLst', {}, [element('p:cond', { delay })])

/** The behaviour that makes a shape visible or not; every effect carries one. */
function visibility(id: number, shapeId: number, to: string): XmlNode {
  return element('p:set', {}, [
    element('p:cBhvr', {}, [
      element('p:cTn', { id: String(id), dur: '1', fill: 'hold' }, [condition('0')]),
      element('p:tgtEl', {}, [element('p:spTgt', { spid: String(shapeId) })]),
      element('p:attrNameLst', {}, [element('p:attrName', {}, [{ '#text': 'style.visibility' }])]),
    ]),
    element('p:to', {}, [element('p:strVal', { val: to })]),
  ])
}

/** The effect node itself: what it is, what it is aimed at, how long it takes. */
function effectNode(id: number, effect: NewEffect, recipe: Recipe): XmlNode {
  const duration = Math.max(Math.round(effect.duration ?? 500), 1)
  const behaviours: XmlNode[] = []

  // An exit hides the shape at the end of the effect rather than the start, so
  // the hiding is stated after the thing that plays.
  if (recipe.kind !== 'emphasis' && recipe.filter === null) {
    behaviours.push(
      visibility(id + 1, effect.shapeId, recipe.kind === 'exit' ? 'hidden' : 'visible'),
    )
  }

  if (recipe.filter !== null) {
    if (recipe.kind === 'entrance') {
      behaviours.push(visibility(id + 1, effect.shapeId, 'visible'))
    }

    behaviours.push(
      element(
        'p:animEffect',
        { transition: recipe.kind === 'exit' ? 'out' : 'in', filter: recipe.filter },
        [
          element('p:cBhvr', {}, [
            element('p:cTn', { id: String(id + 2), dur: String(duration) }),
            element('p:tgtEl', {}, [element('p:spTgt', { spid: String(effect.shapeId) })]),
          ]),
        ],
      ),
    )

    if (recipe.kind === 'exit') {
      behaviours.push(visibility(id + 3, effect.shapeId, 'hidden'))
    }
  }

  if (recipe.kind === 'emphasis') {
    // A pulse is the shape's own scale, taken up and put back. Stated as two
    // halves because `p:animScale` describes where it ends, not a round trip.
    behaviours.push(
      element('p:animScale', {}, [
        element('p:cBhvr', {}, [
          element('p:cTn', { id: String(id + 2), dur: String(duration), autoRev: '1' }),
          element('p:tgtEl', {}, [element('p:spTgt', { spid: String(effect.shapeId) })]),
        ]),
        element('p:by', { x: '110000', y: '110000' }),
      ]),
    )
  }

  return element('p:par', {}, [
    element(
      'p:cTn',
      {
        id: String(id),
        presetID: String(recipe.presetId),
        presetClass: CLASSES[recipe.kind],
        presetSubtype: '0',
        fill: 'hold',
        nodeType: NODE_TYPES[effect.trigger],
      },
      [
        condition(String(Math.max(Math.round(effect.delay ?? 0), 0))),
        element('p:childTnLst', {}, behaviours),
      ],
    ),
  ])
}

/** The two wrappers a click step puts between the sequence and the effect. */
function stepNode(id: number, inner: XmlNode): XmlNode {
  return element('p:par', {}, [
    element('p:cTn', { id: String(id), fill: 'hold' }, [
      condition('indefinite'),
      element('p:childTnLst', {}, [
        element('p:par', {}, [
          element('p:cTn', { id: String(id + 1), fill: 'hold' }, [
            condition('0'),
            element('p:childTnLst', {}, [inner]),
          ]),
        ]),
      ]),
    ]),
  ])
}

const recipeFor = (effect: NewEffect): Recipe | undefined => {
  if (effect.kind === 'emphasis') return effect.name === 'pulse' ? PULSE : undefined
  const table = effect.kind === 'entrance' ? ENTRANCES : EXITS
  return table[effect.name]
}

/**
 * Adds an effect to a slide. Returns whether it could.
 *
 * `click` makes a step of its own; `with` and `after` join the step already
 * there, which is what those words mean — and an effect that has nothing to
 * join makes a step of its own instead of being dropped.
 */
export function addEffect(slide: SlidePart, effect: NewEffect): boolean {
  const recipe = recipeFor(effect)
  if (recipe === undefined) return false

  const timing = timingOf(slide, true)
  const list = timing === undefined ? undefined : mainList(timing)
  if (timing === undefined || list === undefined) return false

  const id = nextId(timing)
  const steps = children(list)
  const last = steps[steps.length - 1]

  if (effect.trigger === 'click' || last === undefined) {
    children(list).push(stepNode(id, effectNode(id + 2, effect, recipe)))
    return true
  }

  // Into the inner list of the step already open, beside the effect it follows.
  const inner = allTimings(last)
    .map((node) => findChild(node, 'p:childTnLst'))
    .filter((node): node is XmlNode => node !== undefined)[1]

  if (inner === undefined) {
    children(list).push(stepNode(id, effectNode(id + 2, effect, recipe)))
    return true
  }

  children(inner).push(effectNode(id, effect, recipe))
  return true
}

/** The effect node with a given `p:cTn` id, and the list holding it. */
function locate(
  timing: XmlNode,
  id: number,
): { parent: XmlNode; node: XmlNode; timing: XmlNode } | null {
  const walk = (node: XmlNode): { parent: XmlNode; node: XmlNode; timing: XmlNode } | null => {
    for (const child of children(node)) {
      const own = findChild(child, 'p:cTn')
      if (own !== undefined && Number(attribute(own, 'id')) === id) {
        return { parent: node, node: child, timing: own }
      }

      const found = walk(child)
      if (found !== null) return found
    }
    return null
  }

  return walk(timing)
}

/**
 * Takes an effect out.
 *
 * The step around it goes too when nothing is left in it: a press that plays
 * nothing is a press that looks like the show has frozen.
 */
export function removeEffect(slide: SlidePart, id: number): boolean {
  const timing = timingOf(slide, false)
  if (timing === undefined) return false

  const found = locate(timing, id)
  if (found === null) return false

  const nodes = children(found.parent)
  nodes.splice(nodes.indexOf(found.node), 1)

  const list = mainList(timing)
  if (list === undefined) return true

  for (const step of [...children(list)]) {
    if (allTimings(step).some((node) => attribute(node, 'nodeType') !== undefined)) continue
    const steps = children(list)
    steps.splice(steps.indexOf(step), 1)
  }

  return true
}

export interface EffectChange {
  duration?: number
  delay?: number
  trigger?: Trigger
}

/** Changes how long an effect takes, how long it waits, and what starts it. */
export function setEffectTiming(slide: SlidePart, id: number, change: EffectChange): boolean {
  const timing = timingOf(slide, false)
  const found = timing === undefined ? null : locate(timing, id)
  if (found === null) return false

  let changed = false

  if (change.trigger !== undefined) {
    setAttribute(found.timing, 'nodeType', NODE_TYPES[change.trigger])
    changed = true
  }

  if (change.delay !== undefined) {
    const list = findChild(found.timing, 'p:stCondLst')
    const condition_ = list === undefined ? undefined : findChild(list, 'p:cond')
    if (condition_ !== undefined) {
      setAttribute(condition_, 'delay', String(Math.max(Math.round(change.delay), 0)))
      changed = true
    }
  }

  if (change.duration !== undefined) {
    // On the behaviour rather than on the effect: the length is where the work
    // is, and the one-millisecond `p:set` beside it is not the length.
    const wanted = String(Math.max(Math.round(change.duration), 1))
    for (const node of allTimings(found.node)) {
      const stated = Number(attribute(node, 'dur'))
      if (Number.isFinite(stated) && stated > 1) {
        setAttribute(node, 'dur', wanted)
        changed = true
      }
    }
  }

  return changed
}

/** Moves a step to another place in the order the slide plays them. */
export function moveStep(slide: SlidePart, from: number, to: number): boolean {
  const timing = timingOf(slide, false)
  const list = timing === undefined ? undefined : mainList(timing)
  if (list === undefined) return false

  const steps = children(list)
  const moving = steps[from]
  if (moving === undefined || from === to || to < 0 || to >= steps.length) return false

  steps.splice(from, 1)
  steps.splice(to, 0, moving)
  return true
}
