import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readColorChild } from './color'
import type { Color } from './color'

/**
 * `a:spPr` — what a shape looks like: its outline shape, its fill, its line.
 *
 * Read for drawing only. Nothing here is written back from the model: an edit
 * patches the original subtree, which is what keeps the effects, 3-D and
 * extension lists we do not model (ADR 0002).
 *
 * One distinction runs through all of it. **Absent is not the same as none.**
 * A shape with no `a:solidFill` and no `a:noFill` inherits its fill from the
 * style reference or the placeholder it follows; a shape with `a:noFill` is
 * deliberately transparent. Collapsing the two makes every unstyled shape
 * either invisible or wrongly filled, so `null` means "not stated" everywhere
 * in this file and `{ kind: 'none' }` means the file said no.
 */

export type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Color | null }
  | { kind: 'gradient'; stops: GradientStop[]; angle: number | null; radial: boolean }
  | { kind: 'pattern'; preset: string | null; foreground: Color | null; background: Color | null }
  | { kind: 'picture'; relationshipId: string | null }
  /** `a:grpFill` — take whatever the enclosing group has. */
  | { kind: 'group' }

export interface GradientStop {
  /** 0 to 1 along the gradient. */
  position: number
  color: Color | null
}

export type LineCap = 'flat' | 'round' | 'square'

export interface Arrow {
  /** `triangle`, `stealth`, `oval`, `arrow`, `diamond`, `none`. */
  type: string
  width: string | null
  length: string | null
}

export interface Line {
  /** Stroke width in EMU; null when the shape does not state one. */
  width: number | null
  fill: Fill | null
  /** `a:prstDash` — `solid`, `dash`, `sysDot`, … */
  dash: string | null
  cap: LineCap | null
  head: Arrow | null
  tail: Arrow | null
}

export interface Geometry {
  kind: 'preset' | 'custom'
  /** `rect`, `ellipse`, `rightArrow`, … Null for custom geometry. */
  preset: string | null
  /**
   * `a:avLst` adjustments, by name.
   *
   * These reshape a preset — the corner radius of a rounded rectangle, the head
   * size of an arrow — and are exactly the kind of thing lost by rebuilding a
   * shape from a model that only knows "rounded rectangle".
   */
  adjustments: Map<string, string>
}

/** `p:style` — the theme slots a shape takes its look from when it states none. */
export interface StyleReference {
  /** Index into the theme's format scheme, 1-based. */
  index: number
  color: Color | null
}

export interface ShapeStyle {
  line: StyleReference | null
  fill: StyleReference | null
  effect: StyleReference | null
  font: StyleReference | null
}

export interface ShapeProperties {
  geometry: Geometry | null
  fill: Fill | null
  line: Line | null
}

const numberOr = (value: string | undefined, fallback: number | null): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const FILL_TAGS = new Set([
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:pattFill',
  'a:blipFill',
  'a:grpFill',
])

function readGradient(element: XmlNode): Fill {
  const list = findChild(element, 'a:gsLst')
  const stops = (list === undefined ? [] : children(list))
    .filter((stop) => tagName(stop) === 'a:gs')
    .map((stop) => ({
      // Written in thousandths of a percent, like every other DrawingML ratio.
      position: (numberOr(attribute(stop, 'pos'), 0) ?? 0) / 100000,
      color: readColorChild(stop),
    }))

  const linear = findChild(element, 'a:lin')

  return {
    kind: 'gradient',
    stops,
    // 60000ths of a degree, clockwise from the positive x axis.
    angle: linear === undefined ? null : numberOr(attribute(linear, 'ang'), null),
    radial: findChild(element, 'a:path') !== undefined,
  }
}

/** Reads a fill element. Returns null for anything that is not one. */
export function readFill(element: XmlNode): Fill | null {
  switch (tagName(element)) {
    case 'a:noFill':
      return { kind: 'none' }
    case 'a:solidFill':
      return { kind: 'solid', color: readColorChild(element) }
    case 'a:gradFill':
      return readGradient(element)
    case 'a:pattFill': {
      const foreground = findChild(element, 'a:fgClr')
      const background = findChild(element, 'a:bgClr')
      return {
        kind: 'pattern',
        preset: attribute(element, 'prst') ?? null,
        foreground: foreground === undefined ? null : readColorChild(foreground),
        background: background === undefined ? null : readColorChild(background),
      }
    }
    case 'a:blipFill': {
      const blip = findChild(element, 'a:blip')
      return {
        kind: 'picture',
        relationshipId: (blip === undefined ? undefined : attribute(blip, 'r:embed')) ?? null,
      }
    }
    case 'a:grpFill':
      return { kind: 'group' }
    default:
      return null
  }
}

/** The fill a container states, or null when it states none. */
function fillIn(parent: XmlNode): Fill | null {
  const element = children(parent).find((child) => FILL_TAGS.has(tagName(child) ?? ''))
  return element === undefined ? null : readFill(element)
}

function readArrow(element: XmlNode | undefined): Arrow | null {
  if (element === undefined) return null
  const type = attribute(element, 'type')
  if (type === undefined) return null

  return {
    type,
    width: attribute(element, 'w') ?? null,
    length: attribute(element, 'len') ?? null,
  }
}

export function readLine(element: XmlNode): Line {
  const dash = findChild(element, 'a:prstDash')
  const cap = attribute(element, 'cap')

  return {
    width: numberOr(attribute(element, 'w'), null),
    fill: fillIn(element),
    dash: dash === undefined ? null : (attribute(dash, 'val') ?? null),
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : cap === 'flat' ? 'flat' : null,
    head: readArrow(findChild(element, 'a:headEnd')),
    tail: readArrow(findChild(element, 'a:tailEnd')),
  }
}

function readGeometry(properties: XmlNode): Geometry | null {
  const preset = findChild(properties, 'a:prstGeom')
  if (preset !== undefined) {
    const list = findChild(preset, 'a:avLst')
    const adjustments = new Map<string, string>()

    for (const guide of list === undefined ? [] : children(list)) {
      if (tagName(guide) !== 'a:gd') continue
      const name = attribute(guide, 'name')
      const formula = attribute(guide, 'fmla')
      if (name !== undefined && formula !== undefined) adjustments.set(name, formula)
    }

    return { kind: 'preset', preset: attribute(preset, 'prst') ?? null, adjustments }
  }

  if (findChild(properties, 'a:custGeom') !== undefined) {
    // The path is not modelled; a custom shape draws from its own XML and is
    // written back from it.
    return { kind: 'custom', preset: null, adjustments: new Map() }
  }

  return null
}

/** Reads `a:spPr` / `p:spPr`. */
export function readShapeProperties(properties: XmlNode): ShapeProperties {
  const line = findChild(properties, 'a:ln')

  return {
    geometry: readGeometry(properties),
    fill: fillIn(properties),
    line: line === undefined ? null : readLine(line),
  }
}

function readStyleReference(element: XmlNode | undefined): StyleReference | null {
  if (element === undefined) return null

  return {
    index: numberOr(attribute(element, 'idx'), 0) ?? 0,
    color: readColorChild(element),
  }
}

/**
 * Reads `p:style`.
 *
 * Resolving these against the theme's `a:fmtScheme` is not done yet, so a shape
 * that states no fill of its own currently draws unfilled rather than in its
 * theme colour. Reading them now means the model already carries what that will
 * need, and the shape's own `phClr` — which is what the reference is invoked
 * with — is right here beside the index.
 */
export function readShapeStyle(style: XmlNode): ShapeStyle {
  return {
    line: readStyleReference(findChild(style, 'a:lnRef')),
    fill: readStyleReference(findChild(style, 'a:fillRef')),
    effect: readStyleReference(findChild(style, 'a:effectRef')),
    font: readStyleReference(findChild(style, 'a:fontRef')),
  }
}

/** `a:effectLst` is preserved but not modelled; this only says whether one is there. */
export function hasEffects(properties: XmlNode): boolean {
  const list = findChild(properties, 'a:effectLst')
  return list !== undefined && children(list).length > 0
}
