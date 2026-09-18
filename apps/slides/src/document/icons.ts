/**
 * The icons the app ships with.
 *
 * Built from numbers rather than copied as path strings: every one of these is
 * a polygon or a circle with coordinates that can be worked out, and a set
 * written by hand is a set where nobody can say whether the star has five
 * points until they look at it.
 *
 * They are drawn in a 24-unit square, like every icon set, and inserted as
 * custom geometry so a deck can fill and outline them from its theme.
 */

/** The box every icon is drawn in. */
export const ICON_SIZE = 24

const MIDDLE = ICON_SIZE / 2

type Point = readonly [number, number]

const trim = (value: number) => Number(value.toFixed(2))

/** A closed outline through the points given. */
function polygon(points: readonly Point[]): string {
  const [first, ...rest] = points
  if (first === undefined) return ''

  const lines = rest.map(([x, y]) => `L ${String(trim(x))} ${String(trim(y))}`).join(' ')
  return `M ${String(trim(first[0]))} ${String(trim(first[1]))} ${lines} Z`
}

/** Points evenly around a circle, the first one at the top. */
function around(count: number, radius: number, offset = 0): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + offset + (index * 2 * Math.PI) / count
    return [MIDDLE + radius * Math.cos(angle), MIDDLE + radius * Math.sin(angle)] as const
  })
}

/**
 * A circle as four cubics.
 *
 * `k` is the reach of the control points that makes a bezier arc a quarter
 * circle to within a thousandth of the radius — the constant every drawing
 * program uses, because there is no exact answer.
 */
function circle(radius: number, clockwise = true): string {
  const k = radius * 0.5522847498
  const [right, bottom, left, top] = [
    [MIDDLE + radius, MIDDLE],
    [MIDDLE, MIDDLE + radius],
    [MIDDLE - radius, MIDDLE],
    [MIDDLE, MIDDLE - radius],
  ] as const

  const arcs = clockwise
    ? [
        [[MIDDLE + radius, MIDDLE + k], [MIDDLE + k, MIDDLE + radius], bottom],
        [[MIDDLE - k, MIDDLE + radius], [MIDDLE - radius, MIDDLE + k], left],
        [[MIDDLE - radius, MIDDLE - k], [MIDDLE - k, MIDDLE - radius], top],
        [[MIDDLE + k, MIDDLE - radius], [MIDDLE + radius, MIDDLE - k], right],
      ]
    : [
        [[MIDDLE + radius, MIDDLE - k], [MIDDLE + k, MIDDLE - radius], top],
        [[MIDDLE - k, MIDDLE - radius], [MIDDLE - radius, MIDDLE - k], left],
        [[MIDDLE - radius, MIDDLE + k], [MIDDLE - k, MIDDLE + radius], bottom],
        [[MIDDLE + k, MIDDLE + radius], [MIDDLE + radius, MIDDLE + k], right],
      ]

  const curves = arcs
    .map(
      (arc) =>
        `C ${arc.map((point) => `${String(trim(point[0]))} ${String(trim(point[1]))}`).join(' ')}`,
    )
    .join(' ')

  return `M ${String(trim(right[0]))} ${String(trim(right[1]))} ${curves} Z`
}

/** A star with `points` points, alternating between the two radii. */
function star(points: number, outer: number, inner: number): string {
  const spikes = around(points, outer)
  const valleys = around(points, inner, Math.PI / points)

  return polygon(spikes.flatMap((spike, index) => [spike, valleys[index] ?? spike]))
}

/** A bar of `thickness`, from one side to the other. */
const bar = (thickness: number, length: number): Point[] => [
  [MIDDLE - length / 2, MIDDLE - thickness / 2],
  [MIDDLE + length / 2, MIDDLE - thickness / 2],
  [MIDDLE + length / 2, MIDDLE + thickness / 2],
  [MIDDLE - length / 2, MIDDLE + thickness / 2],
]

export interface Icon {
  id: string
  label: string
  /** One or more outlines; a second is how a hole stays a hole. */
  paths: string[]
}

/**
 * A cross, going round the outline once.
 *
 * Twelve corners: out along one arm, round its end, back in, and the same three
 * more times. Written out rather than made from two bars laid over each other,
 * because two overlapping rectangles are two outlines and this is one.
 */
const PLUS: Point[] = (() => {
  const thin = 3
  const long = 9

  return [
    [MIDDLE - thin, MIDDLE - long],
    [MIDDLE + thin, MIDDLE - long],
    [MIDDLE + thin, MIDDLE - thin],
    [MIDDLE + long, MIDDLE - thin],
    [MIDDLE + long, MIDDLE + thin],
    [MIDDLE + thin, MIDDLE + thin],
    [MIDDLE + thin, MIDDLE + long],
    [MIDDLE - thin, MIDDLE + long],
    [MIDDLE - thin, MIDDLE + thin],
    [MIDDLE - long, MIDDLE + thin],
    [MIDDLE - long, MIDDLE - thin],
    [MIDDLE - thin, MIDDLE - thin],
  ]
})()

export const ICONS: readonly Icon[] = [
  { id: 'circle', label: 'Circle', paths: [circle(11)] },
  {
    id: 'ring',
    label: 'Ring',
    // The inner circle is wound the other way, which is what makes it a hole
    // rather than a second disc on top of the first.
    paths: [circle(11), circle(6, false)],
  },
  { id: 'square', label: 'Square', paths: [polygon(bar(22, 22))] },
  { id: 'triangle', label: 'Triangle', paths: [polygon(around(3, 11))] },
  { id: 'diamond', label: 'Diamond', paths: [polygon(around(4, 11))] },
  { id: 'hexagon', label: 'Hexagon', paths: [polygon(around(6, 11))] },
  { id: 'star', label: 'Star', paths: [star(5, 11, 4.6)] },
  { id: 'burst', label: 'Burst', paths: [star(8, 11, 5.5)] },
  { id: 'minus', label: 'Minus', paths: [polygon(bar(4, 18))] },
  { id: 'plus', label: 'Plus', paths: [polygon(PLUS)] },
  {
    id: 'check',
    label: 'Check',
    paths: [
      polygon([
        [3.5, 12.5],
        [6, 10],
        [9.75, 13.75],
        [18, 5.5],
        [20.5, 8],
        [9.75, 18.75],
      ]),
    ],
  },
  {
    id: 'cross',
    label: 'Cross',
    paths: [
      polygon([
        [6.5, 4.5],
        [12, 10],
        [17.5, 4.5],
        [19.5, 6.5],
        [14, 12],
        [19.5, 17.5],
        [17.5, 19.5],
        [12, 14],
        [6.5, 19.5],
        [4.5, 17.5],
        [10, 12],
        [4.5, 6.5],
      ]),
    ],
  },
  {
    id: 'arrow-right',
    label: 'Arrow',
    paths: [
      polygon([
        [3, 9.5],
        [14, 9.5],
        [14, 5],
        [21, 12],
        [14, 19],
        [14, 14.5],
        [3, 14.5],
      ]),
    ],
  },
]
