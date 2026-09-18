/**
 * Preset geometry as SVG paths.
 *
 * DrawingML defines more than 180 presets, each a parametric path in the spec.
 * What is here is every one this app draws; anything else falls back to its
 * bounding rectangle.
 *
 * The fallback is a real decision, not a stub. A shape drawn as a rectangle is
 * in the right place at the right size with the right fill, which is close
 * enough to read a slide by — and it is never written back, so an approximation
 * on screen costs the file nothing (ADR 0002).
 *
 * The paths are the presets at their default proportions. `a:avLst` — the
 * handles that make an arrow's head wider or a rectangle's corner rounder — is
 * kept in the model and written back untouched, but not applied here. A shape
 * somebody has reshaped therefore draws at the proportions it started with,
 * which is a difference on screen only.
 */

/** A shape's box in the coordinate space the path is written in. */
export interface Box {
  width: number
  height: number
}

/**
 * What a shape's handles say, read from `a:avLst`.
 *
 * Values are hundred-thousandths, and almost all of them are a fraction of the
 * **shorter side** of the box — `ss` in the format's own formulas. A rounded
 * rectangle's corner stays round rather than becoming an ellipse when the
 * rectangle is stretched, and that is why: the radius is measured against the
 * side that did not grow.
 */
export type Adjust = (name: string, fallback: number) => number

type PathOf = (box: Box, adjust: Adjust) => string

const n = (value: number): string => String(Math.round(value * 100) / 100)

/** An `a:gd` holds a formula; the ones in `a:avLst` are a literal value. */
function adjustments(list: ReadonlyMap<string, string> | undefined): Adjust {
  return (name, fallback) => {
    const formula = list?.get(name)
    const match = formula === undefined ? null : /^val\s+(-?\d+)$/u.exec(formula.trim())
    return match?.[1] === undefined ? fallback : Number(match[1])
  }
}

/** A hundred-thousandths value as a plain fraction. */
const share = (value: number): number => value / 100000

/**
 * Every handle at its default.
 *
 * For a shape drawn as part of another one: a callout's rounded body takes its
 * corner from nowhere, because the callout's own handle means where the tail
 * points and not how round the box is.
 */
const NO_ADJUST: Adjust = (_name, fallback) => fallback

type Point = readonly [number, number]

/** A closed path through the points given, in order. */
const polygon =
  (points: (box: Box) => Point[]): PathOf =>
  (box) =>
    `${points(box)
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${n(x)},${n(y)}`)
      .join(' ')} Z`

/** An open path, for the shapes that are a stroke rather than an area. */
const polyline =
  (points: (box: Box) => Point[]): PathOf =>
  (box) =>
    points(box)
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${n(x)},${n(y)}`)
      .join(' ')

const rectangle: PathOf = ({ width, height }) => `M0,0 H${n(width)} V${n(height)} H0 Z`

/** What happens at one corner of a rectangle. */
type Corner = 'sharp' | 'round' | 'snip'

/**
 * A rectangle whose four corners are each sharp, rounded or cut off.
 *
 * One generator for nine presets, because that is all that separates them:
 * `snip2DiagRect` and `round2DiagRect` differ by an arc, and writing each out
 * by hand would be writing the same rectangle nine times with one letter
 * changed. Corners are given clockwise from the top left, as the format lists
 * them, and each names the handle that sets its radius — two-cornered presets
 * have a handle each, which is why the name is per corner rather than shared.
 */
const cornered =
  (
    kinds: readonly [Corner, Corner, Corner, Corner],
    handles: readonly [string, string, string, string] = ['adj', 'adj', 'adj', 'adj'],
    fallback = 16667,
  ): PathOf =>
  ({ width, height }, adjust) => {
    const shortest = Math.min(width, height)

    const corners = [
      { at: [0, 0], into: [0, -1], out: [1, 0], kind: kinds[0], handle: handles[0] },
      { at: [width, 0], into: [1, 0], out: [0, 1], kind: kinds[1], handle: handles[1] },
      { at: [width, height], into: [0, 1], out: [-1, 0], kind: kinds[2], handle: handles[2] },
      { at: [0, height], into: [-1, 0], out: [0, -1], kind: kinds[3], handle: handles[3] },
    ] as const

    const commands = corners.flatMap((corner, index) => {
      const move = index === 0 ? 'M' : 'L'
      const [x, y] = corner.at
      if (corner.kind === 'sharp') return [`${move}${n(x)},${n(y)}`]

      // Half the shorter side is as far as a corner can eat; beyond that the
      // two corners of a side would cross and the path would fold over itself.
      const radius = Math.min(share(adjust(corner.handle, fallback)) * shortest, shortest / 2)
      const entry = `${move}${n(x - corner.into[0] * radius)},${n(y - corner.into[1] * radius)}`
      const exitX = x + corner.out[0] * radius
      const exitY = y + corner.out[1] * radius

      return [
        entry,
        corner.kind === 'round'
          ? `A${n(radius)},${n(radius)} 0 0 1 ${n(exitX)},${n(exitY)}`
          : `L${n(exitX)},${n(exitY)}`,
      ]
    })

    return `${commands.join(' ')} Z`
  }

const ellipse: PathOf = ({ width, height }) => {
  const [rx, ry] = [width / 2, height / 2]
  return `M0,${n(ry)} A${n(rx)},${n(ry)} 0 0 1 ${n(width)},${n(ry)} A${n(rx)},${n(ry)} 0 0 1 0,${n(ry)} Z`
}

/**
 * An ellipse inside the box given, as one subpath.
 *
 * `clockwise` is what makes a hole: two rings drawn the same way fill solid,
 * and one drawn against the other leaves the middle empty without anything
 * having to say `fill-rule`.
 */
const ring = (cx: number, cy: number, rx: number, ry: number, clockwise = true): string => {
  const sweep = clockwise ? 1 : 0
  return (
    `M${n(cx - rx)},${n(cy)} ` +
    `A${n(rx)},${n(ry)} 0 0 ${String(sweep)} ${n(cx + rx)},${n(cy)} ` +
    `A${n(rx)},${n(ry)} 0 0 ${String(sweep)} ${n(cx - rx)},${n(cy)} Z`
  )
}

/** A regular polygon with `sides` sides, the first point at the top. */
const regular = (sides: number): PathOf =>
  polygon(({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    return Array.from({ length: sides }, (_, index) => {
      const angle = (index * 2 * Math.PI) / sides - Math.PI / 2
      return [cx + Math.cos(angle) * cx, cy + Math.sin(angle) * cy] as Point
    })
  })

/** A star with `points` spikes, the inner radius a fraction of the outer. */
const star = (points: number, innerRatio: number): PathOf =>
  polygon(({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    const step = Math.PI / points

    return Array.from({ length: points * 2 }, (_, index) => {
      const radius = index % 2 === 0 ? 1 : innerRatio
      // Starts at the top, which is where PowerPoint puts the first point.
      const angle = index * step - Math.PI / 2
      return [cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius] as Point
    })
  })

/**
 * A block arrow pointing right, as fractions of the box.
 *
 * `head` is how much of the width the point takes, `shaft` how much of the
 * height the tail is. The other three directions are this one turned, which is
 * cheaper to read than four lists of seven coordinates that differ by a sign.
 */
const arrowPoints = (head: number, shaft: number): Point[] => {
  const top = (1 - shaft) / 2
  return [
    [0, top],
    [1 - head, top],
    [1 - head, 0],
    [1, 0.5],
    [1 - head, 1],
    [1 - head, 1 - top],
    [0, 1 - top],
  ]
}

/** Turns a shape given in unit coordinates by a quarter turn at a time. */
const turned = (points: readonly Point[], quarters: number): Point[] =>
  points.map(([x, y]) => {
    switch (((quarters % 4) + 4) % 4) {
      case 1:
        return [1 - y, x] as Point
      case 2:
        return [1 - x, 1 - y] as Point
      case 3:
        return [y, 1 - x] as Point
      default:
        return [x, y] as Point
    }
  })

/** Scales unit coordinates onto the box. */
const scaled = (points: readonly Point[]): PathOf =>
  polygon(({ width, height }) => points.map(([x, y]) => [x * width, y * height] as Point))

/**
 * A block arrow, at whatever proportions its handles state.
 *
 * `adj1` is how thick the tail is across the box; `adj2` is how long the head
 * is, measured against the shorter side. That second one is why a wide arrow
 * has a short head rather than one that grows with it — the head is a piece of
 * the arrow, not a share of the slide.
 */
const blockArrow =
  (quarters: number): PathOf =>
  (box, adjust) => {
    const along = quarters % 2 === 0 ? box.width : box.height
    const shortest = Math.min(box.width, box.height)

    const shaft = Math.min(share(adjust('adj1', 50000)), 1)
    const head = Math.min((share(adjust('adj2', 50000)) * shortest) / along, 1)

    return scaled(turned(arrowPoints(head, shaft), quarters))(box, adjust)
  }

const PRESETS: Readonly<Record<string, PathOf>> = {
  // Rectangles, and the eight ways their corners can be treated.
  rect: rectangle,
  roundRect: cornered(['round', 'round', 'round', 'round']),
  round1Rect: cornered(['sharp', 'round', 'sharp', 'sharp']),
  round2SameRect: cornered(['round', 'round', 'sharp', 'sharp'], ['adj1', 'adj1', 'adj2', 'adj2']),
  round2DiagRect: cornered(['round', 'sharp', 'round', 'sharp'], ['adj1', 'adj1', 'adj2', 'adj2']),
  snip1Rect: cornered(['sharp', 'snip', 'sharp', 'sharp']),
  snip2SameRect: cornered(['snip', 'snip', 'sharp', 'sharp'], ['adj1', 'adj1', 'adj2', 'adj2']),
  snip2DiagRect: cornered(['snip', 'sharp', 'snip', 'sharp'], ['adj1', 'adj1', 'adj2', 'adj2']),
  // The snipped corner and the rounded one have a handle each.
  snipRoundRect: cornered(['snip', 'round', 'sharp', 'sharp'], ['adj1', 'adj2', 'adj2', 'adj2']),
  // Not a regular eight-sided figure: in this format an octagon is a rectangle
  // with all four corners cut off, and it is drawn as one.
  octagon: cornered(['snip', 'snip', 'snip', 'snip'], ['adj', 'adj', 'adj', 'adj'], 29289),

  ellipse,
  // A circle is an ellipse in a square box; PowerPoint has no separate preset.
  flowChartConnector: ellipse,
  flowChartProcess: rectangle,
  flowChartAlternateProcess: cornered(['round', 'round', 'round', 'round']),

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
  parallelogram: ({ width, height }, adjust) => {
    const lean = Math.min(share(adjust('adj', 25000)) * Math.min(width, height), width)
    return polygon(() => [
      [lean, 0],
      [width, 0],
      [width - lean, height],
      [0, height],
    ])({ width, height }, adjust)
  },
  trapezoid: ({ width, height }, adjust) => {
    const inset = Math.min(share(adjust('adj', 25000)) * Math.min(width, height), width / 2)
    return polygon(() => [
      [inset, 0],
      [width - inset, 0],
      [width, height],
      [0, height],
    ])({ width, height }, adjust)
  },
  pentagon: regular(5),
  hexagon: polygon(({ width, height }) => [
    [width * 0.25, 0],
    [width * 0.75, 0],
    [width, height / 2],
    [width * 0.75, height],
    [width * 0.25, height],
    [0, height / 2],
  ]),
  heptagon: regular(7),
  decagon: regular(10),
  dodecagon: regular(12),

  /** A cross. `plus` is the shape; `mathPlus` below is the sign. */
  plus: ({ width, height }, adjust) => {
    const arm = Math.min(share(adjust('adj', 25000)) * Math.min(width, height), width / 2)
    return polygon(() => [
      [arm, 0],
      [width - arm, 0],
      [width - arm, arm],
      [width, arm],
      [width, height - arm],
      [width - arm, height - arm],
      [width - arm, height],
      [arm, height],
      [arm, height - arm],
      [0, height - arm],
      [0, arm],
      [arm, arm],
    ])({ width, height }, adjust)
  },
  corner: scaled([
    [0, 0],
    [0.5, 0],
    [0.5, 0.5],
    [1, 0.5],
    [1, 1],
    [0, 1],
  ]),
  diagStripe: scaled([
    [0, 1],
    [0, 0.5],
    [0.5, 0],
    [1, 0],
  ]),
  homePlate: ({ width, height }, adjust) => {
    const point = Math.min(share(adjust('adj', 16667)) * Math.min(width, height), width)
    return polygon(() => [
      [0, 0],
      [width - point, 0],
      [width, height / 2],
      [width - point, height],
      [0, height],
    ])({ width, height }, adjust)
  },
  chevron: ({ width, height }, adjust) => {
    const point = Math.min(share(adjust('adj', 50000)) * Math.min(width, height), width / 2)
    return polygon(() => [
      [0, 0],
      [width - point, 0],
      [width, height / 2],
      [width - point, height],
      [0, height],
      [point, height / 2],
    ])({ width, height }, adjust)
  },
  bevel: ({ width, height }, adjust) => {
    const inset = Math.min(share(adjust('adj', 12500)) * Math.min(width, height), width / 2)
    return `${rectangle({ width, height }, adjust)} M${n(inset)},${n(inset)} H${n(width - inset)} V${n(height - inset)} H${n(inset)} Z`
  },
  frame: ({ width, height }, adjust) => {
    const inset = Math.min(share(adjust('adj1', 12500)) * Math.min(width, height), width / 2)
    // The inner rectangle runs the other way, which is what leaves the hole.
    return (
      `${rectangle({ width, height }, adjust)} M${n(inset)},${n(inset)} V${n(height - inset)} ` +
      `H${n(width - inset)} V${n(inset)} Z`
    )
  },
  halfFrame: scaled([
    [0, 0],
    [1, 0],
    [0.78, 0.22],
    [0.22, 0.22],
    [0.22, 1],
  ]),
  donut: ({ width, height }, adjust) => {
    const [cx, cy] = [width / 2, height / 2]
    const thickness = Math.min(share(adjust('adj', 25000)) * Math.min(width, height), cx, cy)
    return `${ring(cx, cy, cx, cy)} ${ring(cx, cy, cx - thickness, cy - thickness, false)}`
  },
  noSmoking: ({ width, height }, adjust) => {
    const [cx, cy] = [width / 2, height / 2]
    // The ring, and the bar across it as a separate shape drawn over it.
    return (
      `${ring(cx, cy, cx, cy)} ${ring(cx, cy, cx * 0.75, cy * 0.75, false)} ` +
      polygon(() => [
        [width * 0.14, height * 0.25],
        [width * 0.25, height * 0.14],
        [width * 0.86, height * 0.75],
        [width * 0.75, height * 0.86],
      ])({ width, height }, adjust)
    )
  },
  can: ({ width, height }, adjust) => {
    const ry = Math.min((share(adjust('adj', 25000)) * Math.min(width, height)) / 2, height / 2)
    const rx = width / 2
    return [
      `M0,${n(ry)}`,
      `A${n(rx)},${n(ry)} 0 0 1 ${n(width)},${n(ry)}`,
      `V${n(height - ry)}`,
      `A${n(rx)},${n(ry)} 0 0 1 0,${n(height - ry)}`,
      'Z',
      // The lip: the near half of the top ellipse, so the tube reads as round.
      `M0,${n(ry)}`,
      `A${n(rx)},${n(ry)} 0 0 0 ${n(width)},${n(ry)}`,
    ].join(' ')
  },
  cube: ({ width, height }) => {
    const depth = Math.min(width, height) * 0.25
    return [
      `M0,${n(depth)}`,
      `L${n(depth)},0`,
      `L${n(width)},0`,
      `L${n(width)},${n(height - depth)}`,
      `L${n(width - depth)},${n(height)}`,
      `L0,${n(height)}`,
      'Z',
      // The two edges that make it a box rather than a hexagon.
      `M0,${n(depth)} L${n(width - depth)},${n(depth)} L${n(width)},0`,
      `M${n(width - depth)},${n(depth)} L${n(width - depth)},${n(height)}`,
    ].join(' ')
  },
  plaque: ({ width, height }) => {
    const cut = Math.min(width, height) * 0.16
    // The corners curve inward, which is the whole of what a plaque is.
    return [
      `M${n(cut)},0`,
      `H${n(width - cut)}`,
      `A${n(cut)},${n(cut)} 0 0 0 ${n(width)},${n(cut)}`,
      `V${n(height - cut)}`,
      `A${n(cut)},${n(cut)} 0 0 0 ${n(width - cut)},${n(height)}`,
      `H${n(cut)}`,
      `A${n(cut)},${n(cut)} 0 0 0 0,${n(height - cut)}`,
      `V${n(cut)}`,
      `A${n(cut)},${n(cut)} 0 0 0 ${n(cut)},0`,
      'Z',
    ].join(' ')
  },
  foldedCorner: ({ width, height }) => {
    const fold = Math.min(width, height) * 0.19
    return [
      `M0,0 H${n(width)} V${n(height - fold)} L${n(width - fold)},${n(height)} H0 Z`,
      `M${n(width - fold)},${n(height)} L${n(width - fold)},${n(height - fold)} L${n(width)},${n(height - fold)} Z`,
    ].join(' ')
  },
  teardrop: ({ width, height }) => {
    const [rx, ry] = [width / 2, height / 2]
    return [
      `M0,${n(ry)}`,
      `A${n(rx)},${n(ry)} 0 0 1 ${n(rx)},0`,
      `L${n(width)},0`,
      `L${n(width)},${n(ry)}`,
      `A${n(rx)},${n(ry)} 0 0 1 ${n(rx)},${n(height)}`,
      `A${n(rx)},${n(ry)} 0 0 1 0,${n(ry)}`,
      'Z',
    ].join(' ')
  },
  pie: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    // Three quarters, which is the default the format states.
    return `M${n(cx)},${n(cy)} L${n(cx)},0 A${n(cx)},${n(cy)} 0 1 1 0,${n(cy)} Z`
  },
  chord: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    return `M${n(cx)},0 A${n(cx)},${n(cy)} 0 1 1 0,${n(cy)} Z`
  },
  blockArc: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    const [ix, iy] = [cx * 0.6, cy * 0.6]
    return [
      `M0,${n(cy)}`,
      `A${n(cx)},${n(cy)} 0 0 1 ${n(width)},${n(cy)}`,
      `L${n(cx + ix)},${n(cy)}`,
      `A${n(ix)},${n(iy)} 0 0 0 ${n(cx - ix)},${n(cy)}`,
      'Z',
    ].join(' ')
  },
  moon: ({ width, height }) => {
    const ry = height / 2
    // The outer edge, then back along an inner one: what is left is a crescent.
    return [
      `M${n(width)},0`,
      `A${n(width)},${n(ry)} 0 0 0 ${n(width)},${n(height)}`,
      `A${n(width * 0.45)},${n(ry * 0.9)} 0 0 1 ${n(width)},0`,
      'Z',
    ].join(' ')
  },
  heart: ({ width, height }) => {
    const [w, h] = [width, height]
    return [
      `M${n(w / 2)},${n(h)}`,
      `C${n(-w * 0.15)},${n(h * 0.5)} ${n(w * 0.1)},${n(-h * 0.1)} ${n(w / 2)},${n(h * 0.28)}`,
      `C${n(w * 0.9)},${n(-h * 0.1)} ${n(w * 1.15)},${n(h * 0.5)} ${n(w / 2)},${n(h)}`,
      'Z',
    ].join(' ')
  },
  lightningBolt: scaled([
    [0.44, 0],
    [0.83, 0.42],
    [0.6, 0.47],
    [0.95, 0.86],
    [0.72, 0.89],
    [0.85, 1],
    [0.36, 0.71],
    [0.6, 0.66],
    [0.24, 0.39],
    [0.48, 0.35],
    [0.13, 0.08],
  ]),
  sun: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    const rays = Array.from({ length: 8 }, (_, index) => {
      const angle = (index * Math.PI) / 4
      const point: Point = [cx + Math.cos(angle) * cx, cy + Math.sin(angle) * cy]
      const left: Point = [
        cx + Math.cos(angle - 0.2) * cx * 0.62,
        cy + Math.sin(angle - 0.2) * cy * 0.62,
      ]
      const right: Point = [
        cx + Math.cos(angle + 0.2) * cx * 0.62,
        cy + Math.sin(angle + 0.2) * cy * 0.62,
      ]
      return `M${n(left[0])},${n(left[1])} L${n(point[0])},${n(point[1])} L${n(right[0])},${n(right[1])} Z`
    })

    return [ring(cx, cy, cx * 0.62, cy * 0.62), ...rays].join(' ')
  },
  smileyFace: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    return [
      ring(cx, cy, cx, cy),
      ring(cx * 0.65, cy * 0.7, cx * 0.1, cy * 0.14, false),
      ring(cx * 1.35, cy * 0.7, cx * 0.1, cy * 0.14, false),
      `M${n(cx * 0.55)},${n(cy * 1.25)} Q${n(cx)},${n(cy * 1.75)} ${n(cx * 1.45)},${n(cy * 1.25)}`,
    ].join(' ')
  },
  cloud: ({ width, height }) => {
    const [w, h] = [width, height]
    return [
      `M${n(w * 0.2)},${n(h * 0.85)}`,
      `A${n(w * 0.16)},${n(h * 0.2)} 0 0 1 ${n(w * 0.15)},${n(h * 0.5)}`,
      `A${n(w * 0.18)},${n(h * 0.22)} 0 0 1 ${n(w * 0.35)},${n(h * 0.25)}`,
      `A${n(w * 0.2)},${n(h * 0.25)} 0 0 1 ${n(w * 0.68)},${n(h * 0.22)}`,
      `A${n(w * 0.18)},${n(h * 0.22)} 0 0 1 ${n(w * 0.88)},${n(h * 0.52)}`,
      `A${n(w * 0.16)},${n(h * 0.2)} 0 0 1 ${n(w * 0.8)},${n(h * 0.85)}`,
      'Z',
    ].join(' ')
  },
  // A seal is meant to look torn, so its points are uneven on purpose; the
  // unevenness is written down rather than random, because a shape that redrew
  // differently on every render would be a different shape each time.
  irregularSeal1: polygon(({ width, height }) => {
    const radii = [1, 0.5, 0.92, 0.42, 1, 0.55, 0.86, 0.4, 0.98, 0.5, 0.9, 0.46]
    const [cx, cy] = [width / 2, height / 2]
    return radii.map((radius, index) => {
      const angle = (index * Math.PI) / 6 - Math.PI / 2
      return [cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius] as Point
    })
  }),
  irregularSeal2: star(12, 0.55),

  // Arrows. One shape turned four ways, plus the ones that are not a turn of it.
  rightArrow: blockArrow(0),
  downArrow: blockArrow(1),
  leftArrow: blockArrow(2),
  upArrow: blockArrow(3),
  notchedRightArrow: scaled([
    [0, 0.25],
    [0.6, 0.25],
    [0.6, 0],
    [1, 0.5],
    [0.6, 1],
    [0.6, 0.75],
    [0, 0.75],
    [0.15, 0.5],
  ]),
  stripedRightArrow: ({ width, height }, adjust) => {
    const body = scaled([
      [0.16, 0.25],
      [0.6, 0.25],
      [0.6, 0],
      [1, 0.5],
      [0.6, 1],
      [0.6, 0.75],
      [0.16, 0.75],
    ])({ width, height }, adjust)
    const stripes = [
      `M0,${n(height * 0.25)} H${n(width * 0.04)} V${n(height * 0.75)} H0 Z`,
      `M${n(width * 0.06)},${n(height * 0.25)} H${n(width * 0.13)} V${n(height * 0.75)} H${n(width * 0.06)} Z`,
    ]
    return [body, ...stripes].join(' ')
  },
  leftRightArrow: scaled([
    [0, 0.5],
    [0.25, 0],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.75, 0.75],
    [0.25, 0.75],
    [0.25, 1],
  ]),
  upDownArrow: scaled([
    [0.5, 0],
    [1, 0.25],
    [0.75, 0.25],
    [0.75, 0.75],
    [1, 0.75],
    [0.5, 1],
    [0, 0.75],
    [0.25, 0.75],
    [0.25, 0.25],
    [0, 0.25],
  ]),
  quadArrow: scaled([
    [0.5, 0],
    [0.72, 0.22],
    [0.6, 0.22],
    [0.6, 0.4],
    [0.78, 0.4],
    [0.78, 0.28],
    [1, 0.5],
    [0.78, 0.72],
    [0.78, 0.6],
    [0.6, 0.6],
    [0.6, 0.78],
    [0.72, 0.78],
    [0.5, 1],
    [0.28, 0.78],
    [0.4, 0.78],
    [0.4, 0.6],
    [0.22, 0.6],
    [0.22, 0.72],
    [0, 0.5],
    [0.22, 0.28],
    [0.22, 0.4],
    [0.4, 0.4],
    [0.4, 0.22],
    [0.28, 0.22],
  ]),
  leftRightUpArrow: scaled([
    [0.5, 0],
    [0.72, 0.25],
    [0.6, 0.25],
    [0.6, 0.55],
    [0.78, 0.55],
    [0.78, 0.43],
    [1, 0.65],
    [0.78, 0.87],
    [0.78, 0.75],
    [0.22, 0.75],
    [0.22, 0.87],
    [0, 0.65],
    [0.22, 0.43],
    [0.22, 0.55],
    [0.4, 0.55],
    [0.4, 0.25],
    [0.28, 0.25],
  ]),
  bentArrow: scaled([
    [0, 1],
    [0, 0.6],
    [0.45, 0.6],
    [0.45, 0.25],
    [0.3, 0.25],
    [0.6, 0],
    [0.9, 0.25],
    [0.75, 0.25],
    [0.75, 0.9],
    [0.3, 0.9],
    [0.3, 1],
  ]),
  bentUpArrow: scaled([
    [0, 0.72],
    [0.55, 0.72],
    [0.55, 0.25],
    [0.4, 0.25],
    [0.7, 0],
    [1, 0.25],
    [0.85, 0.25],
    [0.85, 1],
    [0, 1],
  ]),
  uturnArrow: scaled([
    [0, 1],
    [0, 0.35],
    [0.25, 0.35],
    [0.45, 0.35],
    [0.45, 0.6],
    [0.6, 0.6],
    [0.6, 0.25],
    [0.45, 0.25],
    [0.72, 0],
    [1, 0.25],
    [0.85, 0.25],
    [0.85, 0.85],
    [0.3, 0.85],
    [0.3, 1],
  ]),

  // The signs, which are thin bars rather than the block shapes above.
  mathPlus: scaled([
    [0.42, 0.1],
    [0.58, 0.1],
    [0.58, 0.42],
    [0.9, 0.42],
    [0.9, 0.58],
    [0.58, 0.58],
    [0.58, 0.9],
    [0.42, 0.9],
    [0.42, 0.58],
    [0.1, 0.58],
    [0.1, 0.42],
    [0.42, 0.42],
  ]),
  mathMinus: scaled([
    [0.1, 0.42],
    [0.9, 0.42],
    [0.9, 0.58],
    [0.1, 0.58],
  ]),
  mathEqual: ({ width, height }) =>
    [
      `M${n(width * 0.1)},${n(height * 0.32)} H${n(width * 0.9)} V${n(height * 0.44)} H${n(width * 0.1)} Z`,
      `M${n(width * 0.1)},${n(height * 0.56)} H${n(width * 0.9)} V${n(height * 0.68)} H${n(width * 0.1)} Z`,
    ].join(' '),
  mathNotEqual: ({ width, height }) =>
    [
      `M${n(width * 0.1)},${n(height * 0.36)} H${n(width * 0.9)} V${n(height * 0.46)} H${n(width * 0.1)} Z`,
      `M${n(width * 0.1)},${n(height * 0.56)} H${n(width * 0.9)} V${n(height * 0.66)} H${n(width * 0.1)} Z`,
      `M${n(width * 0.58)},${n(height * 0.1)} L${n(width * 0.68)},${n(height * 0.12)} L${n(width * 0.42)},${n(height * 0.9)} L${n(width * 0.32)},${n(height * 0.88)} Z`,
    ].join(' '),
  mathMultiply: scaled([
    [0.22, 0.12],
    [0.5, 0.4],
    [0.78, 0.12],
    [0.88, 0.22],
    [0.6, 0.5],
    [0.88, 0.78],
    [0.78, 0.88],
    [0.5, 0.6],
    [0.22, 0.88],
    [0.12, 0.78],
    [0.4, 0.5],
    [0.12, 0.22],
  ]),
  mathDivide: ({ width, height }) =>
    [
      `M${n(width * 0.1)},${n(height * 0.44)} H${n(width * 0.9)} V${n(height * 0.56)} H${n(width * 0.1)} Z`,
      ring(width * 0.5, height * 0.2, width * 0.07, height * 0.07),
      ring(width * 0.5, height * 0.8, width * 0.07, height * 0.07),
    ].join(' '),

  star4: star(4, 0.38),
  star5: star(5, 0.38),
  star6: star(6, 0.58),
  star7: star(7, 0.55),
  star8: star(8, 0.38),
  star10: star(10, 0.58),
  star12: star(12, 0.58),
  star16: star(16, 0.68),
  star24: star(24, 0.74),
  star32: star(32, 0.79),

  // Flowchart. The shapes are the notation, so a diagram that uses one we do
  // not draw is a diagram that reads wrong rather than one that looks plain.
  flowChartDecision: polygon(({ width, height }) => [
    [width / 2, 0],
    [width, height / 2],
    [width / 2, height],
    [0, height / 2],
  ]),
  flowChartInputOutput: polygon(({ width, height }) => [
    [width * 0.25, 0],
    [width, 0],
    [width * 0.75, height],
    [0, height],
  ]),
  flowChartTerminator: ({ width, height }) => {
    // A stadium: two semicircles joined by a pair of straight edges.
    const radius = Math.min(width, height) / 2
    return [
      `M${n(radius)},0`,
      `L${n(width - radius)},0`,
      `A${n(radius)},${n(radius)} 0 0 1 ${n(width - radius)},${n(height)}`,
      `L${n(radius)},${n(height)}`,
      `A${n(radius)},${n(radius)} 0 0 1 ${n(radius)},0`,
      'Z',
    ].join(' ')
  },
  flowChartPreparation: polygon(({ width, height }) => [
    [width * 0.2, 0],
    [width * 0.8, 0],
    [width, height / 2],
    [width * 0.8, height],
    [width * 0.2, height],
    [0, height / 2],
  ]),
  flowChartPredefinedProcess: ({ width, height }, adjust) =>
    [
      rectangle({ width, height }, adjust),
      `M${n(width * 0.12)},0 V${n(height)}`,
      `M${n(width * 0.88)},0 V${n(height)}`,
    ].join(' '),
  flowChartInternalStorage: ({ width, height }, adjust) =>
    [
      rectangle({ width, height }, adjust),
      `M${n(width * 0.12)},0 V${n(height)}`,
      `M0,${n(height * 0.12)} H${n(width)}`,
    ].join(' '),
  flowChartDocument: ({ width, height }) => {
    const wave = height * 0.12
    return [
      `M0,0 H${n(width)} V${n(height - wave)}`,
      `Q${n(width * 0.75)},${n(height)} ${n(width * 0.5)},${n(height - wave)}`,
      `T0,${n(height - wave)}`,
      'Z',
    ].join(' ')
  },
  flowChartMultidocument: ({ width, height }) => {
    const wave = height * 0.1
    const step = height * 0.12
    const sheet = (offsetX: number, offsetY: number, w: number, h: number) =>
      [
        `M${n(offsetX)},${n(offsetY)} H${n(offsetX + w)} V${n(offsetY + h - wave)}`,
        `Q${n(offsetX + w * 0.75)},${n(offsetY + h)} ${n(offsetX + w * 0.5)},${n(offsetY + h - wave)}`,
        `T${n(offsetX)},${n(offsetY + h - wave)}`,
        'Z',
      ].join(' ')

    // Three sheets, the back two peeking out: that is the whole notation.
    return [
      sheet(width * 0.16, 0, width * 0.84, height - step * 2),
      sheet(width * 0.08, step, width * 0.84, height - step * 2),
      sheet(0, step * 2, width * 0.84, height - step * 2),
    ].join(' ')
  },
  flowChartManualInput: polygon(({ width, height }) => [
    [0, height * 0.2],
    [width, 0],
    [width, height],
    [0, height],
  ]),
  flowChartManualOperation: polygon(({ width, height }) => [
    [0, 0],
    [width, 0],
    [width * 0.8, height],
    [width * 0.2, height],
  ]),
  flowChartOffpageConnector: polygon(({ width, height }) => [
    [0, 0],
    [width, 0],
    [width, height * 0.8],
    [width / 2, height],
    [0, height * 0.8],
  ]),
  flowChartPunchedCard: polygon(({ width, height }) => [
    [width * 0.2, 0],
    [width, 0],
    [width, height],
    [0, height],
    [0, height * 0.2],
  ]),
  flowChartPunchedTape: ({ width, height }) => {
    const wave = height * 0.1
    return [
      `M0,${n(wave)}`,
      `Q${n(width * 0.25)},0 ${n(width * 0.5)},${n(wave)}`,
      `T${n(width)},${n(wave)}`,
      `V${n(height - wave)}`,
      `Q${n(width * 0.75)},${n(height)} ${n(width * 0.5)},${n(height - wave)}`,
      `T0,${n(height - wave)}`,
      'Z',
    ].join(' ')
  },
  flowChartSummingJunction: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    const offset = 0.2929
    return [
      ring(cx, cy, cx, cy),
      `M${n(width * offset)},${n(height * offset)} L${n(width * (1 - offset))},${n(height * (1 - offset))}`,
      `M${n(width * (1 - offset))},${n(height * offset)} L${n(width * offset)},${n(height * (1 - offset))}`,
    ].join(' ')
  },
  flowChartOr: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    return [ring(cx, cy, cx, cy), `M${n(cx)},0 V${n(height)}`, `M0,${n(cy)} H${n(width)}`].join(' ')
  },
  flowChartCollate: polygon(({ width, height }) => [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]),
  flowChartSort: ({ width, height }, adjust) =>
    [
      polygon(() => [
        [width / 2, 0],
        [width, height / 2],
        [width / 2, height],
        [0, height / 2],
      ])({ width, height }, adjust),
      `M0,${n(height / 2)} H${n(width)}`,
    ].join(' '),
  flowChartExtract: polygon(({ width, height }) => [
    [width / 2, 0],
    [width, height],
    [0, height],
  ]),
  flowChartMerge: polygon(({ width, height }) => [
    [0, 0],
    [width, 0],
    [width / 2, height],
  ]),
  flowChartOnlineStorage: ({ width, height }) => {
    const rx = width * 0.17
    return [
      `M${n(width)},0`,
      `H${n(rx)}`,
      `A${n(rx)},${n(height / 2)} 0 0 0 ${n(rx)},${n(height)}`,
      `H${n(width)}`,
      `A${n(rx)},${n(height / 2)} 0 0 1 ${n(width)},0`,
      'Z',
    ].join(' ')
  },
  flowChartDelay: ({ width, height }) => {
    const rx = width * 0.25
    return [
      `M0,0`,
      `H${n(width - rx)}`,
      `A${n(rx)},${n(height / 2)} 0 0 1 ${n(width - rx)},${n(height)}`,
      `H0`,
      'Z',
    ].join(' ')
  },
  flowChartMagneticTape: ({ width, height }) => {
    const [cx, cy] = [width / 2, height / 2]
    return [
      `M${n(width * 0.75)},${n(height * 0.9)}`,
      `A${n(cx)},${n(cy)} 0 1 1 ${n(width * 0.93)},${n(height * 0.75)}`,
      `L${n(width)},${n(height)}`,
      `H${n(cx)}`,
      'Z',
    ].join(' ')
  },
  flowChartMagneticDisk: ({ width, height }) => {
    const ry = height * 0.17
    const rx = width / 2
    return [
      `M0,${n(ry)}`,
      `A${n(rx)},${n(ry)} 0 0 1 ${n(width)},${n(ry)}`,
      `V${n(height - ry)}`,
      `A${n(rx)},${n(ry)} 0 0 1 0,${n(height - ry)}`,
      'Z',
      `M0,${n(ry)} A${n(rx)},${n(ry)} 0 0 0 ${n(width)},${n(ry)}`,
    ].join(' ')
  },
  flowChartMagneticDrum: ({ width, height }) => {
    const rx = width * 0.17
    const ry = height / 2
    return [
      `M${n(rx)},0`,
      `H${n(width - rx)}`,
      `A${n(rx)},${n(ry)} 0 0 1 ${n(width - rx)},${n(height)}`,
      `H${n(rx)}`,
      `A${n(rx)},${n(ry)} 0 0 1 ${n(rx)},0`,
      'Z',
      `M${n(width - rx)},0 A${n(rx)},${n(ry)} 0 0 0 ${n(width - rx)},${n(height)}`,
    ].join(' ')
  },
  flowChartDisplay: ({ width, height }) => {
    const rx = width * 0.17
    return [
      `M${n(rx)},0`,
      `H${n(width - rx)}`,
      `L${n(width)},${n(height / 2)}`,
      `L${n(width - rx)},${n(height)}`,
      `H${n(rx)}`,
      `A${n(rx)},${n(height / 2)} 0 0 1 ${n(rx)},0`,
      'Z',
    ].join(' ')
  },

  // Callouts: a box with a tail, which is the whole of what makes them one.
  // The tail hangs from the bottom left, where PowerPoint's own default puts it.
  wedgeRectCallout: ({ width, height }) => {
    const body = height * 0.75
    return [
      `M0,0`,
      `L${n(width)},0`,
      `L${n(width)},${n(body)}`,
      `L${n(width * 0.35)},${n(body)}`,
      `L${n(width * 0.2)},${n(height)}`,
      `L${n(width * 0.25)},${n(body)}`,
      `L0,${n(body)}`,
      'Z',
    ].join(' ')
  },
  wedgeRoundRectCallout: ({ width, height }) => {
    const body = height * 0.75
    const radius = Math.min(width, body) * 0.16
    return [
      cornered(['round', 'round', 'round', 'round'])({ width, height: body }, NO_ADJUST),
      `M${n(width * 0.35)},${n(body - radius * 0.1)}`,
      `L${n(width * 0.2)},${n(height)}`,
      `L${n(width * 0.25)},${n(body - radius * 0.1)}`,
      'Z',
    ].join(' ')
  },
  wedgeEllipseCallout: ({ width, height }) => {
    const body = height * 0.75
    const rx = width / 2
    const ry = body / 2
    return [
      `M${n(rx)},0`,
      `A${n(rx)},${n(ry)} 0 1 1 ${n(rx - 0.01)},0`,
      'Z',
      `M${n(width * 0.34)},${n(body * 0.95)}`,
      `L${n(width * 0.2)},${n(height)}`,
      `L${n(width * 0.46)},${n(body)}`,
      'Z',
    ].join(' ')
  },
  cloudCallout: ({ width, height }) => {
    const body = height * 0.78
    const [w, h] = [width, body]
    return [
      `M${n(w * 0.2)},${n(h * 0.85)}`,
      `A${n(w * 0.16)},${n(h * 0.2)} 0 0 1 ${n(w * 0.15)},${n(h * 0.5)}`,
      `A${n(w * 0.18)},${n(h * 0.22)} 0 0 1 ${n(w * 0.35)},${n(h * 0.25)}`,
      `A${n(w * 0.2)},${n(h * 0.25)} 0 0 1 ${n(w * 0.68)},${n(h * 0.22)}`,
      `A${n(w * 0.18)},${n(h * 0.22)} 0 0 1 ${n(w * 0.88)},${n(h * 0.52)}`,
      `A${n(w * 0.16)},${n(h * 0.2)} 0 0 1 ${n(w * 0.8)},${n(h * 0.85)}`,
      'Z',
      // The two bubbles that lead to whoever is speaking.
      ring(width * 0.25, height * 0.9, width * 0.06, height * 0.05),
      ring(width * 0.16, height * 0.99, width * 0.035, height * 0.03),
    ].join(' ')
  },
  // The line callouts are a box and a line to what they point at. Which of the
  // three it is decides how many bends the line has, and nothing else.
  borderCallout1: ({ width, height }, adjust) => {
    const body = height * 0.7
    return [
      rectangle({ width, height: body }, adjust),
      `M${n(width * 0.15)},${n(body)} L0,${n(height)}`,
    ].join(' ')
  },
  borderCallout2: ({ width, height }, adjust) => {
    const body = height * 0.65
    return [
      rectangle({ width, height: body }, adjust),
      `M${n(width * 0.15)},${n(body)} L${n(width * 0.08)},${n(height * 0.85)} L0,${n(height)}`,
    ].join(' ')
  },
  borderCallout3: ({ width, height }, adjust) => {
    const body = height * 0.6
    return [
      rectangle({ width, height: body }, adjust),
      `M${n(width * 0.15)},${n(body)} L${n(width * 0.15)},${n(height * 0.8)} L${n(width * 0.05)},${n(height * 0.8)} L0,${n(height)}`,
    ].join(' ')
  },

  // Brackets and braces: a stroke around something, never an area.
  leftBracket: ({ width, height }) => {
    const rx = Math.min(width, height * 0.25)
    return `M${n(width)},0 H${n(rx)} A${n(rx)},${n(rx)} 0 0 0 0,${n(rx)} V${n(height - rx)} A${n(rx)},${n(rx)} 0 0 0 ${n(rx)},${n(height)} H${n(width)}`
  },
  rightBracket: ({ width, height }) => {
    const rx = Math.min(width, height * 0.25)
    return `M0,0 H${n(width - rx)} A${n(rx)},${n(rx)} 0 0 1 ${n(width)},${n(rx)} V${n(height - rx)} A${n(rx)},${n(rx)} 0 0 1 ${n(width - rx)},${n(height)} H0`
  },
  bracketPair: ({ width, height }) => {
    const rx = Math.min(width * 0.25, height * 0.25)
    return [
      `M${n(width * 0.25)},0 H${n(rx)} A${n(rx)},${n(rx)} 0 0 0 0,${n(rx)} V${n(height - rx)} A${n(rx)},${n(rx)} 0 0 0 ${n(rx)},${n(height)} H${n(width * 0.25)}`,
      `M${n(width * 0.75)},0 H${n(width - rx)} A${n(rx)},${n(rx)} 0 0 1 ${n(width)},${n(rx)} V${n(height - rx)} A${n(rx)},${n(rx)} 0 0 1 ${n(width - rx)},${n(height)} H${n(width * 0.75)}`,
    ].join(' ')
  },
  leftBrace: ({ width, height }) => {
    const [w, h] = [width, height]
    return `M${n(w)},0 Q${n(w * 0.5)},0 ${n(w * 0.5)},${n(h * 0.25)} Q${n(w * 0.5)},${n(h * 0.5)} 0,${n(h * 0.5)} Q${n(w * 0.5)},${n(h * 0.5)} ${n(w * 0.5)},${n(h * 0.75)} Q${n(w * 0.5)},${n(h)} ${n(w)},${n(h)}`
  },
  rightBrace: ({ width, height }) => {
    const [w, h] = [width, height]
    return `M0,0 Q${n(w * 0.5)},0 ${n(w * 0.5)},${n(h * 0.25)} Q${n(w * 0.5)},${n(h * 0.5)} ${n(w)},${n(h * 0.5)} Q${n(w * 0.5)},${n(h * 0.5)} ${n(w * 0.5)},${n(h * 0.75)} Q${n(w * 0.5)},${n(h)} 0,${n(h)}`
  },
  bracePair: ({ width, height }) => {
    const [w, h] = [width, height]
    return [
      `M${n(w * 0.25)},0 Q${n(w * 0.12)},0 ${n(w * 0.12)},${n(h * 0.25)} Q${n(w * 0.12)},${n(h * 0.5)} 0,${n(h * 0.5)} Q${n(w * 0.12)},${n(h * 0.5)} ${n(w * 0.12)},${n(h * 0.75)} Q${n(w * 0.12)},${n(h)} ${n(w * 0.25)},${n(h)}`,
      `M${n(w * 0.75)},0 Q${n(w * 0.88)},0 ${n(w * 0.88)},${n(h * 0.25)} Q${n(w * 0.88)},${n(h * 0.5)} ${n(w)},${n(h * 0.5)} Q${n(w * 0.88)},${n(h * 0.5)} ${n(w * 0.88)},${n(h * 0.75)} Q${n(w * 0.88)},${n(h)} ${n(w * 0.75)},${n(h)}`,
    ].join(' ')
  },
  arc: ({ width, height }) =>
    `M${n(width / 2)},0 A${n(width / 2)},${n(height / 2)} 0 0 1 ${n(width)},${n(height / 2)}`,

  // Banners and waves.
  ribbon: scaled([
    [0, 0],
    [0.16, 0.25],
    [0, 0.5],
    [0.2, 0.5],
    [0.2, 0.75],
    [0.8, 0.75],
    [0.8, 0.5],
    [1, 0.5],
    [0.84, 0.25],
    [1, 0],
    [0.8, 0],
    [0.8, 0.25],
    [0.2, 0.25],
    [0.2, 0],
  ]),
  ribbon2: scaled([
    [0, 1],
    [0.16, 0.75],
    [0, 0.5],
    [0.2, 0.5],
    [0.2, 0.25],
    [0.8, 0.25],
    [0.8, 0.5],
    [1, 0.5],
    [0.84, 0.75],
    [1, 1],
    [0.8, 1],
    [0.8, 0.75],
    [0.2, 0.75],
    [0.2, 1],
  ]),
  wave: ({ width, height }) => {
    const swell = height * 0.15
    return [
      `M0,${n(swell)}`,
      `Q${n(width * 0.25)},${n(-swell)} ${n(width * 0.5)},${n(swell)}`,
      `T${n(width)},${n(swell)}`,
      `V${n(height - swell)}`,
      `Q${n(width * 0.75)},${n(height + swell)} ${n(width * 0.5)},${n(height - swell)}`,
      `T0,${n(height - swell)}`,
      'Z',
    ].join(' ')
  },
  doubleWave: ({ width, height }) => {
    const swell = height * 0.12
    return [
      `M0,${n(swell)}`,
      `Q${n(width * 0.125)},${n(-swell)} ${n(width * 0.25)},${n(swell)}`,
      `T${n(width * 0.5)},${n(swell)}`,
      `T${n(width * 0.75)},${n(swell)}`,
      `T${n(width)},${n(swell)}`,
      `V${n(height - swell)}`,
      `Q${n(width * 0.875)},${n(height + swell)} ${n(width * 0.75)},${n(height - swell)}`,
      `T${n(width * 0.5)},${n(height - swell)}`,
      `T${n(width * 0.25)},${n(height - swell)}`,
      `T0,${n(height - swell)}`,
      'Z',
    ].join(' ')
  },

  // Lines and connectors. A connector states the box it spans, and the path is
  // how it gets from one corner of it to the other.
  line: polyline(({ width, height }) => [
    [0, 0],
    [width, height],
  ]),
  straightConnector1: polyline(({ width, height }) => [
    [0, 0],
    [width, height],
  ]),
  bentConnector2: polyline(({ width, height }) => [
    [0, 0],
    [width, 0],
    [width, height],
  ]),
  bentConnector3: polyline(({ width, height }) => [
    [0, 0],
    [width / 2, 0],
    [width / 2, height],
    [width, height],
  ]),
  bentConnector4: polyline(({ width, height }) => [
    [0, 0],
    [width / 2, 0],
    [width / 2, height / 2],
    [width, height / 2],
    [width, height],
  ]),
  bentConnector5: polyline(({ width, height }) => [
    [0, 0],
    [width / 2, 0],
    [width / 2, height / 2],
    [width, height / 2],
    [width, height],
  ]),
  curvedConnector2: ({ width, height }) => `M0,0 Q${n(width)},0 ${n(width)},${n(height)}`,
  curvedConnector3: ({ width, height }) =>
    `M0,0 C${n(width / 2)},0 ${n(width / 2)},${n(height)} ${n(width)},${n(height)}`,
  curvedConnector4: ({ width, height }) =>
    `M0,0 C${n(width / 2)},0 ${n(width / 2)},${n(height / 2)} ${n(width)},${n(height)}`,
  curvedConnector5: ({ width, height }) =>
    `M0,0 C${n(width / 2)},0 ${n(width / 2)},${n(height)} ${n(width)},${n(height)}`,
}

/**
 * Every preset this app draws.
 *
 * The answer to "which shapes does this app know", which the gallery asks
 * implicitly and a test asks out loud.
 */
export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS)

/** Whether the preset is drawn faithfully or falls back to its bounding box. */
export function isKnownPreset(preset: string | null): boolean {
  return preset !== null && preset in PRESETS
}

/**
 * The SVG path for a preset, in a coordinate space starting at 0,0.
 *
 * `a:avLst` is what the shape's handles say — the corner radius of a rounded
 * rectangle, the head of an arrow. A shape that states none is drawn at the
 * defaults the format states, which is what it looks like in PowerPoint too.
 */
export function pathFor(
  preset: string | null,
  box: Box,
  handles?: ReadonlyMap<string, string>,
): string {
  const path = preset === null ? undefined : PRESETS[preset]
  return (path ?? rectangle)(box, adjustments(handles))
}

/**
 * Shapes that are a stroke rather than an area.
 *
 * A line has no inside, so filling one paints a triangle between its ends. The
 * brackets and the arc are the same case: they are drawn around something, and
 * what they are drawn around is not theirs to colour.
 */
const STROKE_ONLY = new Set([
  'arc',
  'bracketPair',
  'bracePair',
  'leftBracket',
  'rightBracket',
  'leftBrace',
  'rightBrace',
])

export function isLinePreset(preset: string | null): boolean {
  if (preset === null) return false
  return (
    STROKE_ONLY.has(preset) ||
    /^(line|straightConnector|bentConnector|curvedConnector)/u.test(preset)
  )
}
