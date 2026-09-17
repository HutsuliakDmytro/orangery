/**
 * Preset geometry as SVG paths.
 *
 * DrawingML defines more than 180 presets, each a parametric path in the spec.
 * Writing all of them out is a phase of its own; what is here is the set decks
 * actually use, and anything else falls back to its bounding rectangle.
 *
 * The fallback is a real decision, not a stub. A shape drawn as a rectangle is
 * in the right place at the right size with the right fill, which is close
 * enough to read a slide by — and it is never written back, so an approximation
 * on screen costs the file nothing (ADR 0002).
 */

/** A shape's box in the coordinate space the path is written in. */
export interface Box {
  width: number
  height: number
}

type PathOf = (box: Box) => string

const n = (value: number): string => String(Math.round(value * 100) / 100)

const rectangle: PathOf = ({ width, height }) => `M0,0 H${n(width)} V${n(height)} H0 Z`

const rounded =
  (ratio: number): PathOf =>
  ({ width, height }) => {
    const radius = Math.min(width, height) * ratio
    return (
      `M${n(radius)},0 H${n(width - radius)} A${n(radius)},${n(radius)} 0 0 1 ${n(width)},${n(radius)} ` +
      `V${n(height - radius)} A${n(radius)},${n(radius)} 0 0 1 ${n(width - radius)},${n(height)} ` +
      `H${n(radius)} A${n(radius)},${n(radius)} 0 0 1 0,${n(height - radius)} ` +
      `V${n(radius)} A${n(radius)},${n(radius)} 0 0 1 ${n(radius)},0 Z`
    )
  }

const ellipse: PathOf = ({ width, height }) => {
  const [rx, ry] = [width / 2, height / 2]
  return `M0,${n(ry)} A${n(rx)},${n(ry)} 0 0 1 ${n(width)},${n(ry)} A${n(rx)},${n(ry)} 0 0 1 0,${n(ry)} Z`
}

const polygon =
  (points: (box: Box) => [number, number][]): PathOf =>
  (box) =>
    `${points(box)
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${n(x)},${n(y)}`)
      .join(' ')} Z`

/** A star with `points` spikes, the inner radius a fraction of the outer. */
const star = (points: number, innerRatio: number): PathOf =>
  polygon(({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    const step = Math.PI / points

    return Array.from({ length: points * 2 }, (_, index) => {
      const radius = index % 2 === 0 ? 1 : innerRatio
      // Starts at the top, which is where PowerPoint puts the first point.
      const angle = index * step - Math.PI / 2
      return [cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius] as [
        number,
        number,
      ]
    })
  })

const PRESETS: Readonly<Record<string, PathOf>> = {
  rect: rectangle,
  roundRect: rounded(0.16),
  round1Rect: rounded(0.16),
  round2SameRect: rounded(0.16),
  ellipse,
  // A circle is an ellipse in a square box; PowerPoint has no separate preset.
  flowChartConnector: ellipse,
  flowChartProcess: rectangle,
  triangle: polygon(({ width, height }) => [
    [width / 2, 0],
    [width, height],
    [0, height],
  ]),
  rtTriangle: polygon(({ width, height }) => [
    [0, 0],
    [width, height],
    [0, height],
  ]),
  diamond: polygon(({ width, height }) => [
    [width / 2, 0],
    [width, height / 2],
    [width / 2, height],
    [0, height / 2],
  ]),
  parallelogram: polygon(({ width, height }) => [
    [width * 0.25, 0],
    [width, 0],
    [width * 0.75, height],
    [0, height],
  ]),
  trapezoid: polygon(({ width, height }) => [
    [width * 0.25, 0],
    [width * 0.75, 0],
    [width, height],
    [0, height],
  ]),
  pentagon: polygon(({ width, height }) => [
    [width / 2, 0],
    [width, height * 0.38],
    [width * 0.82, height],
    [width * 0.18, height],
    [0, height * 0.38],
  ]),
  hexagon: polygon(({ width, height }) => [
    [width * 0.25, 0],
    [width * 0.75, 0],
    [width, height / 2],
    [width * 0.75, height],
    [width * 0.25, height],
    [0, height / 2],
  ]),
  rightArrow: polygon(({ width, height }) => [
    [0, height * 0.25],
    [width * 0.6, height * 0.25],
    [width * 0.6, 0],
    [width, height / 2],
    [width * 0.6, height],
    [width * 0.6, height * 0.75],
    [0, height * 0.75],
  ]),
  leftArrow: polygon(({ width, height }) => [
    [width, height * 0.25],
    [width * 0.4, height * 0.25],
    [width * 0.4, 0],
    [0, height / 2],
    [width * 0.4, height],
    [width * 0.4, height * 0.75],
    [width, height * 0.75],
  ]),
  upArrow: polygon(({ width, height }) => [
    [width * 0.25, height],
    [width * 0.25, height * 0.4],
    [0, height * 0.4],
    [width / 2, 0],
    [width, height * 0.4],
    [width * 0.75, height * 0.4],
    [width * 0.75, height],
  ]),
  downArrow: polygon(({ width, height }) => [
    [width * 0.25, 0],
    [width * 0.25, height * 0.6],
    [0, height * 0.6],
    [width / 2, height],
    [width, height * 0.6],
    [width * 0.75, height * 0.6],
    [width * 0.75, 0],
  ]),
  star4: star(4, 0.38),
  star5: star(5, 0.38),
  star6: star(6, 0.58),
  star8: star(8, 0.38),
  line: ({ width, height }) => `M0,0 L${n(width)},${n(height)}`,
  straightConnector1: ({ width, height }) => `M0,0 L${n(width)},${n(height)}`,
}

/** Whether the preset is drawn faithfully or falls back to its bounding box. */
export function isKnownPreset(preset: string | null): boolean {
  return preset !== null && preset in PRESETS
}

/**
 * The SVG path for a preset, in a coordinate space starting at 0,0.
 *
 * Adjustment values are not applied yet: a rounded rectangle uses the default
 * corner radius rather than the one in `a:avLst`. The values are kept in the
 * model and written back untouched, so this is a difference on screen only.
 */
export function pathFor(preset: string | null, box: Box): string {
  const path = preset === null ? undefined : PRESETS[preset]
  return (path ?? rectangle)(box)
}

/** A line has no area, so it takes a stroke and never a fill. */
export function isLinePreset(preset: string | null): boolean {
  return preset !== null && /^(line|straightConnector|bentConnector|curvedConnector)/u.test(preset)
}
