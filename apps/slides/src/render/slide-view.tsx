import { Fragment, useMemo } from 'react'
import {
  absoluteTransform,
  autoplayShapes,
  backgroundOf,
  resolveHyperlink,
  colorContextFor,
  flatten,
  listStyleChain,
  layoutOf,
  lookContext,
  masterOf,
  masterShapesShown,
  resolveParagraphProperties,
  resolveRunProperties,
  resolveTransform,
  shapeLook,
  relationshipTarget,
  withAncestors,
  readTableStyles,
  styleFor,
} from '@orangery/ooxml-presentation'
import type {
  Deck,
  Hyperlink,
  Shape,
  Slide,
  SlidePart,
  Transform,
} from '@orangery/ooxml-presentation'
import { getPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import {
  EMU_PER_POINT,
  fontStackFor,
  toSvgPath,
  readChart,
  resolveColor,
  resolveThemeFont,
  shadowOffset,
  textBodyToDoc,
  textOfBody,
} from '@orangery/ooxml-drawingml'
import type { ColorContext, PmNode, Theme } from '@orangery/ooxml-drawingml'
import { fillPaint, linePaint } from './paint'
import { mediaUrl } from './media'
import { TableView } from './table-view'
import { ChartView } from './chart-view'
import type { GradientDefinition } from './paint'
import { isLinePreset, pathFor } from './geometry'
import { applyDrag, applyRotation, SIZING_HANDLES, useDrag } from './use-drag'
import { useMarquee } from './use-marquee'
import { connectorEnds } from '@orangery/ooxml-presentation'
import { enclosedBy, groupToOpen, selectionTarget } from './selection'
import type { Box } from './selection'
import { boundsOf, correct, correctionBetween, NO_CORRECTION, snapRect } from './snap'
import type { Correction, Guide } from './snap'
import { TextEditor } from './text-editor'
import type { DragState, Handle, SizingHandle } from './use-drag'

/**
 * A slide, drawn.
 *
 * Shapes are SVG and text is HTML laid over them at the shape's rectangle
 * (`apps/slides/CLAUDE.md`). Splitting the two is not a compromise: SVG text
 * cannot wrap, and a slide's text wraps inside its box like any other text.
 *
 * Everything is read-only here. Nothing in this file writes to the model, so
 * an approximation on screen — an unhandled preset drawn as its bounding box —
 * costs the file nothing.
 */

/**
 * The lines that say what the shape being dragged has come into line with.
 *
 * Drawn last so they sit over the slide, and in a colour of their own: they are
 * not part of the deck and should never be mistaken for something on it.
 */
function Guides({ guides, slide }: { guides: readonly Guide[]; slide: { width: number } }) {
  if (guides.length === 0) return null

  // One pixel at any zoom would be too thin to see on a slide drawn small.
  const thickness = slide.width / 1200

  return (
    <g data-testid="guides" pointerEvents="none">
      {guides.map((guide) => (
        <line
          key={`${guide.axis}-${String(guide.at)}-${String(guide.from)}-${guide.kind}`}
          x1={guide.axis === 'x' ? guide.at : guide.from}
          x2={guide.axis === 'x' ? guide.at : guide.to}
          y1={guide.axis === 'x' ? guide.from : guide.at}
          y2={guide.axis === 'x' ? guide.to : guide.at}
          stroke="#FF3B8B"
          strokeWidth={thickness}
          strokeDasharray={guide.kind === 'spacing' ? String(thickness * 4) : undefined}
        />
      ))}
    </g>
  )
}

/** How near a shape has to come before it is taken onto a line, in pixels. */
const SNAP_PIXELS = 8

/** A slide is drawn at its own size and scaled by CSS, so one unit is one EMU. */
interface Drawing {
  shape: Shape
  transform: Transform
  look: ReturnType<typeof shapeLook>
  context: ColorContext
  key: string
  /** The groups it sits inside, outermost first; empty at the top level. */
  ancestors: Shape[]
}

function drawingsOf(
  shapes: readonly Shape[],
  prefix: string,
  resolve: (shape: Shape) => Transform | null,
  theme: Theme | undefined,
  base: ColorContext,
) {
  return withAncestors(shapes).flatMap(({ shape, ancestors }, index): Drawing[] => {
    // A group is a coordinate space, not something drawn; its children are.
    if (shape.kind === 'grpSp') return []

    // A hidden shape is hidden before the show starts and after it ends;
    // drawing it would put something on the slide nothing else shows.
    if (shape.hidden) return []

    const transform = absoluteTransform(shape.transform ?? resolve(shape), ancestors)
    if (transform === null) return []

    const look = shapeLook(shape, theme)
    return [
      {
        shape,
        ancestors,
        transform,
        look,
        context: lookContext(base, look),
        key: `${prefix}${String(shape.id)}-${String(index)}`,
      },
    ]
  })
}

/**
 * The shapes the layout and the master draw behind the slide.
 *
 * Placeholders are left out: they are the templates a slide's own shapes
 * inherit from, and drawing them as well would show every slide its layout's
 * "Click to add title". What is left is the furniture — the rules, the logo,
 * the block of colour — which is what "background graphics" names.
 *
 * `showMasterSp` switches it off, and it applies at each rung: a slide can hide
 * everything inherited, and a layout can hide the master's while keeping its
 * own. Neither is drawn for a part that resolves to nothing.
 */
function inheritedDrawings(deck: Deck, slide: Slide, theme: Theme | undefined, base: ColorContext) {
  if (!masterShapesShown(slide)) return []

  const layout = layoutOf(deck, slide)
  const master = layout === null ? null : masterOf(deck, layout)

  const furniture = (part: SlidePart | null) =>
    part === null ? [] : part.shapes.filter((shape) => shape.placeholder === null)

  const fromMaster = layout !== null && !masterShapesShown(layout) ? [] : furniture(master)

  return [
    ...drawingsOf(fromMaster, 'master-', () => null, theme, base),
    ...drawingsOf(furniture(layout), 'layout-', () => null, theme, base),
  ]
}

function drawingsFor(deck: Deck, slide: Slide, theme: Theme | undefined, base: ColorContext) {
  return [
    ...inheritedDrawings(deck, slide, theme, base),
    ...drawingsOf(slide.shapes, '', (shape) => resolveTransform(deck, slide, shape), theme, base),
  ]
}

/**
 * Where each group sits on the slide.
 *
 * Groups are not drawn — their members are — but they can be selected, and a
 * frame has to go somewhere. Kept apart from the drawings rather than folded in
 * as invisible ones, because everything that walks the drawings is asking a
 * question about paint.
 */
function groupBoxesOf(slide: Slide): { shape: Shape; transform: Transform; ancestors: Shape[] }[] {
  return withAncestors(slide.shapes).flatMap(({ shape, ancestors }) => {
    if (shape.kind !== 'grpSp') return []
    const transform = absoluteTransform(shape.transform, ancestors)
    return transform === null ? [] : [{ shape, transform, ancestors }]
  })
}

function Gradient({ definition }: { definition: GradientDefinition }) {
  const stops = definition.stops.map((stop) => (
    <stop
      key={stop.offset}
      offset={`${String(stop.offset * 100)}%`}
      stopColor={stop.color}
      stopOpacity={stop.opacity}
    />
  ))

  if (definition.radial) {
    return <radialGradient id={definition.id}>{stops}</radialGradient>
  }

  // The angle is in 60000ths of a degree, clockwise from the x axis.
  const degrees = (definition.angle ?? 0) / 60000
  return (
    <linearGradient id={definition.id} gradientTransform={`rotate(${String(degrees)} 0.5 0.5)`}>
      {stops}
    </linearGradient>
  )
}

/**
 * The image inside a `p:pic`.
 *
 * `a:srcRect` crops by a fraction from each side, and SVG has no crop: the
 * image is drawn larger than the shape and clipped back to it, which is the
 * same thing seen from the other end.
 */
function ShapeImage({ drawing, pkg, part }: { drawing: Drawing; pkg: OoxmlPackage; part: string }) {
  const { shape, transform, key } = drawing
  if (shape.picture === null) return null

  const url = mediaUrl(pkg, part, shape.picture.relationshipId)
  if (url === null) return null

  const { left, top, right, bottom } = shape.picture.crop
  const visibleWidth = 1 - left - right
  const visibleHeight = 1 - top - bottom
  if (visibleWidth <= 0 || visibleHeight <= 0) return null

  const width = transform.width / visibleWidth
  const height = transform.height / visibleHeight

  return (
    <g transform={`translate(${String(transform.x)} ${String(transform.y)})`}>
      <clipPath id={`clip-${key}`}>
        <rect x={0} y={0} width={transform.width} height={transform.height} />
      </clipPath>
      {/* A picture turns and mirrors like any other shape; it had been doing
          neither, so a deck with a rotated photograph came out square. */}
      <g transform={placement(transform)}>
        <image
          href={url}
          x={-left * width}
          y={-top * height}
          width={width}
          height={height}
          // A picture made see-through is a picture behind the words, and a
          // deck that used one was drawing it solid over them.
          opacity={shape.picture.opacity}
          preserveAspectRatio="none"
          clipPath={`url(#clip-${key})`}
        />
      </g>
    </g>
  )
}

/**
 * A click target over a shape that links somewhere.
 *
 * Only while a show is running: in the editor a click on a shape selects it,
 * and a link that stole that would make a button impossible to move.
 *
 * Transparent and over the shape rather than a handler on the shape itself, so
 * the whole rectangle is clickable — including the parts of it a thin outline
 * leaves empty, which is where people actually click.
 */
function ShapeLink({
  drawing,
  pkg,
  deck,
  part,
  onFollow,
}: {
  drawing: Drawing
  pkg: OoxmlPackage
  deck: Deck
  part: string
  onFollow?: (link: Hyperlink) => void
}) {
  const { shape, transform } = drawing
  const link = resolveHyperlink(pkg, deck, part, shape.link)
  if (link === null || onFollow === undefined) return null

  return (
    <rect
      data-testid="shape-link"
      x={transform.x}
      y={transform.y}
      width={transform.width}
      height={transform.height}
      fill="transparent"
      style={{ cursor: 'pointer' }}
      onPointerDown={(event) => {
        // A click anywhere in a show advances it; this one means the link.
        event.stopPropagation()
        onFollow(link)
      }}
    />
  )
}

/**
 * A film or a sound, where there is somewhere to play it.
 *
 * The poster frame is drawn underneath by the ordinary picture path — it is a
 * picture, and it is what every program shows until somebody presses play. This
 * goes over it only while a show is running: a player in the editor would be a
 * control competing with selecting and moving the thing it sits on.
 *
 * A pointer that lands on it stays on it. In a show a click anywhere advances
 * the slide, and a click on a video means play the video.
 */
function MediaPlayer({
  drawing,
  pkg,
  part,
  autoplay,
}: {
  drawing: Drawing
  pkg: OoxmlPackage
  part: string
  autoplay: boolean
}) {
  const { shape, transform } = drawing
  if (shape.media === null) return null

  // `p14:media` is the embedded copy; `r:link` is the original, which is inside
  // the package as often as not.
  const url =
    mediaUrl(pkg, part, shape.media.embeddedId) ?? mediaUrl(pkg, part, shape.media.relationshipId)
  if (url === null) return null

  const stop = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }

  return (
    <foreignObject
      x={transform.x}
      y={transform.y}
      width={transform.width}
      height={transform.height}
      onPointerDown={stop}
      onClick={stop}
    >
      {shape.media.kind === 'video' ? (
        <video
          data-testid="media-video"
          src={url}
          controls
          autoPlay={autoplay}
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <audio
          data-testid="media-audio"
          src={url}
          controls
          autoPlay={autoplay}
          style={{ width: '100%' }}
        />
      )}
    </foreignObject>
  )
}

/**
 * A chart, which lives in a part of its own.
 *
 * The frame on the slide says only which relationship to follow; everything
 * drawn comes from `ppt/charts/chartN.xml`, and that part goes back into the
 * file untouched.
 */
function ChartFrame({
  drawing,
  pkg,
  part,
  theme,
}: {
  drawing: Drawing
  pkg: OoxmlPackage
  part: string
  theme: Theme | undefined
}) {
  const { shape, transform, context } = drawing
  const target = relationshipTarget(pkg, part, shape.graphic?.relationshipId ?? '')
  const xml = target === null ? undefined : getPartText(pkg, target)
  const chart = xml === undefined ? null : readChart(xml)

  if (chart === null) return null

  return (
    <ChartView
      chart={chart}
      x={transform.x}
      y={transform.y}
      width={transform.width}
      height={transform.height}
      theme={theme}
      context={context}
    />
  )
}

/**
 * How a shape sits in its own box: turned, mirrored, or neither.
 *
 * Written mirror-last so it happens first, because SVG applies a list right to
 * left and OOXML mirrors the geometry and then turns the result. The other
 * order puts an arrow that was flipped and rotated on the wrong side of its box.
 */
function placement(transform: Transform): string | undefined {
  const rotation =
    transform.rotation === 0
      ? ''
      : `rotate(${String(transform.rotation / 60000)} ${String(transform.width / 2)} ${String(
          transform.height / 2,
        )})`

  return `${rotation} ${flipTransform(transform)}`.trim() || undefined
}

/**
 * The mirroring part of a transform, as SVG, about the shape's middle.
 *
 * Empty when the shape is not mirrored, so the common case adds nothing to the
 * attribute at all.
 */
function flipTransform(transform: Transform): string {
  if (!transform.flipHorizontal && !transform.flipVertical) return ''

  const x = transform.width / 2
  const y = transform.height / 2
  const sx = transform.flipHorizontal ? -1 : 1
  const sy = transform.flipVertical ? -1 : 1

  return `translate(${String(x)} ${String(y)}) scale(${String(sx)} ${String(sy)}) translate(${String(-x)} ${String(-y)})`
}

function ShapeOutline({ drawing }: { drawing: Drawing }) {
  const { shape, transform, look, context } = drawing
  const preset = shape.properties?.geometry?.preset ?? null

  const fill = fillPaint(look.fill, context, `fill-${drawing.key}`)
  const stroke = linePaint(look.line, context, (emu) => emu)

  const box = { width: transform.width, height: transform.height }
  const custom = shape.properties?.geometry?.paths ?? null

  // A custom shape draws its own outlines; one holding an arc has none we can
  // draw, and falls back to the box it sits in rather than to three quarters
  // of itself.
  const path =
    custom === null ? pathFor(preset, box) : custom.map((one) => toSvgPath(one, box)).join(' ')
  /**
   * Only the geometry is placed. The words in a shape stay the way round they
   * were written — a mirrored sentence is not what anybody meant by "flip", and
   * it is not what PowerPoint shows either.
   */
  const placed = placement(transform)

  /**
   * The drop shadow, as a filter.
   *
   * A shape with a shadow drawn flat sits on the page instead of above it, and
   * on a deck where every box has one that is the whole design gone. The blur
   * is halved on the way to `stdDeviation`: DrawingML states a radius and SVG
   * a standard deviation, and two of the latter is about one of the former.
   */
  const shadow = shape.properties?.shadow ?? null
  const shadowColor =
    shadow?.color == null ? null : resolveColor(shadow.color, lookContext(context, look))
  const offset = shadow === null ? null : shadowOffset(shadow)
  const filterId = `shadow-${drawing.key}`

  return (
    <g transform={`translate(${String(transform.x)} ${String(transform.y)})`}>
      {(fill.definition || offset !== null) && (
        <defs>
          {fill.definition && <Gradient definition={fill.definition} />}
          {offset !== null && shadow !== null && (
            <filter
              id={filterId}
              filterUnits="userSpaceOnUse"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feDropShadow
                dx={offset.x}
                dy={offset.y}
                stdDeviation={shadow.blur / 2}
                floodColor={shadowColor?.hex ?? '#000000'}
                floodOpacity={shadowColor?.alpha ?? 0.4}
              />
            </filter>
          )}
        </defs>
      )}
      <g transform={placed} filter={offset === null ? undefined : `url(#${filterId})`}>
        <path
          d={path}
          fill={isLinePreset(preset) ? 'none' : fill.paint}
          fillOpacity={fill.opacity}
          {...stroke}
        />
      </g>
    </g>
  )
}

/**
 * The text of a shape, in HTML inside the SVG so it wraps.
 *
 * A `foreignObject` rather than a div layered over the canvas: the viewBox then
 * scales the text with the shapes, in one coordinate space, with no measuring
 * in JavaScript. SVG's own `<text>` cannot wrap, and a slide's text wraps
 * inside its box like any other text.
 */
function ShapeText({
  drawing,
  deck,
  slide,
  theme,
  pkg,
  playing = false,
  editing,
  onCommitText,
  onFollowLink,
  onLeave,
}: {
  drawing: Drawing
  deck: Deck
  slide: Slide
  theme: Theme | undefined
  pkg?: OoxmlPackage
  playing?: boolean
  editing?: boolean
  onCommitText?: (id: number, doc: PmNode) => void
  onFollowLink?: (link: Hyperlink) => void
  onLeave?: () => void
}) {
  const { shape, transform, context } = drawing
  const empty = shape.text !== null && textOfBody(shape.text) === ''

  /**
   * What an empty placeholder says before anyone types in it.
   *
   * Drawn and never written: PowerPoint shows the same prompt and keeps the
   * shape's text body empty in the file, so a deck full of untouched
   * placeholders opens elsewhere as empty boxes rather than as the word
   * "Title".
   */
  const prompt = empty && !(editing === true) ? promptFor(shape) : null

  // A shape being edited shows its editor even when it holds no text yet —
  // that is the only way to put the first word into an empty box.
  if (shape.text === null || (empty && editing !== true && prompt === null)) return null

  const chain = listStyleChain(deck, slide, shape)
  const insets = shape.text.bodyProperties?.insets
  const anchor = shape.text.bodyProperties?.anchor ?? 't'

  /**
   * What autofit has already done to this text.
   *
   * PowerPoint shrinks text that overflows its box and writes down what it
   * shrank it to. Ignoring that draws the text at full size, overflowing the
   * shape exactly as PowerPoint decided it should not — so the recorded scale
   * is applied rather than recomputed. Working out a *new* scale after an edit
   * needs the text measured once laid out, which is a later task.
   */
  const autofit = shape.text.bodyProperties?.autofit
  const scale = autofit?.kind === 'normal' ? (autofit.fontScale ?? 1) : 1
  const lineReduction = autofit?.kind === 'normal' ? (autofit.lineSpaceReduction ?? 0) : 0

  return (
    <foreignObject
      x={transform.x}
      y={transform.y}
      width={transform.width}
      height={transform.height}
    >
      {/* React puts the XHTML namespace on children of a foreignObject itself,
          so the div needs nothing beyond being inside one. */}
      <div
        style={{
          width: '100%',
          height: '100%',
          // PowerPoint's defaults when the shape states none.
          paddingLeft: insets?.left ?? 91440,
          paddingRight: insets?.right ?? 91440,
          paddingTop: insets?.top ?? 45720,
          paddingBottom: insets?.bottom ?? 45720,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start',
          overflow: 'hidden',
        }}
      >
        {prompt !== null ? (
          <p style={{ margin: 0, opacity: 0.45 }}>{prompt}</p>
        ) : editing === true ? (
          <TextEditor
            doc={textBodyToDoc(shape.text)}
            onCommit={(edited) => {
              onCommitText?.(shape.id, edited)
            }}
            onCancel={() => {
              onLeave?.()
            }}
          />
        ) : (
          shape.text.paragraphs.map((paragraph, index) => {
            const properties = resolveParagraphProperties(paragraph.properties, chain)
            const align = properties.align

            return (
              <p
                key={index}
                style={{
                  margin: 0,
                  marginLeft: properties.marginLeft ?? 0,
                  textIndent: properties.indent ?? 0,
                  textAlign:
                    align === 'ctr'
                      ? 'center'
                      : align === 'r'
                        ? 'right'
                        : align === 'just'
                          ? 'justify'
                          : 'left',
                  lineHeight:
                    (properties.lineSpacing?.kind === 'percent'
                      ? properties.lineSpacing.value
                      : 1.2) *
                    (1 - lineReduction),
                }}
              >
                {paragraph.runs.map((run, runIndex) => {
                  const resolved = resolveRunProperties(run.properties, properties)
                  const family = resolveThemeFont(
                    theme?.fonts ?? { major: null, minor: null },
                    resolved?.font ?? undefined,
                  )
                  const named = resolved?.font?.startsWith('+') === true ? family : resolved?.font

                  if (run.kind === 'break') return <br key={runIndex} />

                  // A link on a run is a relationship id and nothing else; what
                  // it points at is a question about the package.
                  const link =
                    pkg === undefined || !playing
                      ? null
                      : resolveHyperlink(pkg, deck, slide.path, {
                          relationshipId: resolved?.hyperlink ?? null,
                          action: null,
                        })

                  const drawn = (
                    <span
                      key={runIndex}
                      style={{
                        fontSize: (resolved?.size ?? 18) * EMU_PER_POINT * scale,
                        fontWeight: resolved?.bold === true ? 700 : 400,
                        fontStyle: resolved?.italic === true ? 'italic' : 'normal',
                        textDecoration:
                          resolved?.underline != null && resolved.underline !== 'none'
                            ? 'underline'
                            : undefined,
                        fontFamily: named == null ? undefined : fontStackFor(named),
                        color: (() => {
                          const colour = resolved?.color
                          if (colour == null) return undefined
                          const paint = fillPaint({ kind: 'solid', color: colour }, context, 'text')
                          return paint.paint === 'none' ? undefined : paint.paint
                        })(),
                      }}
                    >
                      {run.text}
                    </span>
                  )

                  return link === null ? (
                    drawn
                  ) : (
                    <a
                      key={runIndex}
                      href={link.kind === 'url' ? link.url : undefined}
                      style={{ cursor: 'pointer' }}
                      onClick={(event) => {
                        // The browser would follow an href into this window,
                        // and a presentation that navigates away has ended.
                        event.preventDefault()
                        event.stopPropagation()
                        onFollowLink?.(link)
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                      }}
                    >
                      {drawn}
                    </a>
                  )
                })}
              </p>
            )
          })
        )}
      </div>
    </foreignObject>
  )
}

export function SlideView({
  deck,
  slide,
  themes,
  package: pkg,
  selection,
  onSelect,
  onDrag,
  openGroup = null,
  onOpenGroup,
  cropping = null,
  onCrop,
  cells = null,
  onPickCell,
  onMarquee,
  drawing = null,
  onDraw,
  editing,
  onEdit,
  onCommitText,
  playing = false,
  onFollowLink,
  className,
  style,
}: {
  deck: Deck
  slide: Slide
  themes: ReadonlyMap<string, Theme>
  /** Needed for the media a picture points at, which lives in the zip. */
  package?: OoxmlPackage
  /** Shape ids drawn with handles. Absent in a thumbnail, which is not editable. */
  selection?: readonly number[]
  /** Given the shape clicked and whether the click was extending a selection. */
  onSelect?: (id: number | null, extend: boolean) => void
  /** Called once when a drag ends, with how far it went in EMU. */
  onDrag?: (drag: DragState, correction: Correction) => void
  /** The group the pointer is inside, which decides what a click picks out. */
  openGroup?: number | null
  /** The picture being cropped, whose handles then take away rather than resize. */
  cropping?: number | null
  /** The block of cells picked out in a table, and which table it is in. */
  cells?: { table: number; row: number; column: number; toRow: number; toColumn: number } | null
  /** Given the table, the cell clicked, and whether the click extends a block. */
  onPickCell?: (table: number, at: { row: number; column: number }, extend: boolean) => void
  /** Asked to enter crop on a picture, or to leave it with `null`. */
  onCrop?: (id: number | null) => void
  /** Asked to step into a group, or back to the top with `null`. */
  onOpenGroup?: (id: number | null) => void
  /** Given the ids a rubber band enclosed, once it is let go. */
  onMarquee?: (ids: number[]) => void
  /**
   * Set while a shape is armed for drawing.
   *
   * The band on the background then draws the shape out instead of selecting:
   * one gesture, two meanings, decided by whether anything is armed.
   */
  drawing?: string | null
  /** Given the box a shape was drawn out to, in EMU. */
  onDraw?: (box: Box) => void
  /** The shape whose text is open for editing. */
  editing?: number | null
  /** Asked to enter a shape's text, or to leave it with `null`. */
  onEdit?: (id: number | null) => void
  /** The edited document, handed over when the shape is left. */
  onCommitText?: (id: number, doc: PmNode) => void
  /**
   * Whether a film or a sound on the slide gets a player over its poster frame.
   *
   * Only the show sets this. A player in the editor would be a control
   * competing with selecting and moving the thing it sits on.
   */
  playing?: boolean
  /** Called when a link on the slide is clicked, which only a show does. */
  onFollowLink?: (link: Hyperlink) => void
  className?: string
  style?: React.CSSProperties
}) {
  const base = colorContextFor(deck, themes, slide)
  const master = [...deck.masters.values()][0]
  const theme = master?.theme == null ? undefined : themes.get(master.theme)
  const drawings = drawingsFor(deck, slide, theme, base)
  const groupBoxes = groupBoxesOf(slide)

  // Read once per slide rather than per table: the part is the deck's, and a
  // slide with six tables on it would otherwise parse it six times.
  const tableStyles = useMemo(() => (pkg === undefined ? new Map() : readTableStyles(pkg)), [pkg])

  const { width, height } = deck.slideSize

  /** Every selected thing's box, groups included, for the frames and the snap. */
  const selectedBoxes = [
    ...drawings.filter((one) => selection?.includes(one.shape.id) === true),
    ...groupBoxes.filter((one) => selection?.includes(one.shape.id) === true),
  ]

  /**
   * What snapping would add to the drag as it stands, and the lines saying why.
   *
   * Computed from the rectangle around the whole selection rather than shape by
   * shape: dragging three boxes moves one thing, and snapping each of them
   * separately would pull them apart.
   */
  const snapFor = (state: DragState | null) => {
    if (state === null || selection === undefined) return { correction: NO_CORRECTION, guides: [] }

    // Turning moves no edge, so there is no edge to line up with anything.
    if (state.handle === 'rotate') return { correction: NO_CORRECTION, guides: [] }

    const bounds = boundsOf(selectedBoxes.map((one) => one.transform))
    if (bounds === null) return { correction: NO_CORRECTION, guides: [] }

    const applied = applyDrag(bounds, state)
    const { rect, guides } = snapRect({
      rect: applied,
      others: drawings
        .filter((one) => !selection.includes(one.shape.id))
        .map((one) => one.transform),
      slide: deck.slideSize,
      // Eight pixels, which is close enough to feel deliberate and far enough
      // to be reachable without aiming.
      tolerance: SNAP_PIXELS * state.scale,
      resizing: state.handle !== null,
    })

    return { correction: correctionBetween(applied, rect), guides }
  }

  /**
   * The rubber band, and what it caught.
   *
   * Top-level shapes and whole groups, or the members of the group being
   * worked inside: a band means "these things", and which things depends on
   * where you are, exactly as a click does.
   */
  const marquee = useMarquee({
    slideWidth: width,
    slideHeight: height,
    onPick: (band) => {
      // The same gesture draws a shape when one is armed and selects when none
      // is: a band on an empty slide means "this area", and what happens to the
      // area is the only thing that differs.
      if (drawing !== null) {
        onDraw?.(band)
        return
      }

      // Whatever sits at the level the pointer is working at: the top of the
      // slide, or the inside of the group that is open.
      const here = ({ ancestors }: { ancestors: readonly Shape[] }) =>
        openGroup === null ? ancestors.length === 0 : ancestors.at(-1)?.id === openGroup

      const caught = [...drawings, ...groupBoxes].filter(here)

      onMarquee?.(
        caught.filter((one) => enclosedBy(one.transform, band)).map((one) => one.shape.id),
      )
    },
  })

  const drag = useDrag({
    slideWidth: width,
    onCommit: (state) => {
      onDrag?.(state, snapFor(state).correction)
    },
  })

  const snapped = snapFor(drag.state)

  /** While dragging, the selection is drawn where it is being taken. */
  const shown = (drawing: {
    shape: Shape
    transform: Transform
    ancestors?: Shape[]
  }): Transform => {
    const moving =
      selection?.some(
        (id) => id === drawing.shape.id || (drawing.ancestors ?? []).some((one) => one.id === id),
      ) === true

    if (drag.state === null || !moving) return drawing.transform

    if (drag.state.handle === 'rotate') {
      return {
        ...drawing.transform,
        rotation: applyRotation(drawing.transform, drawing.transform, drag.state),
      }
    }

    return {
      ...drawing.transform,
      ...correct(applyDrag(drawing.transform, drag.state), snapped.correction),
    }
  }

  // Which media begins with the slide, asked once rather than per shape.
  const autoplay = playing ? autoplayShapes(slide) : new Set<number>()

  const background = backgroundOf(deck, slide, theme)
  const backgroundPaint = fillPaint(
    background.fill,
    { ...base, placeholderColor: background.placeholderColor ?? undefined },
    'slide-background',
  )

  return (
    <div
      className={className}
      data-testid="slide"
      style={{
        position: 'relative',
        aspectRatio: `${String(width)} / ${String(height)}`,
        ...style,
      }}
    >
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        role="img"
        aria-label={slideLabel(slide)}
      >
        {backgroundPaint.definition && (
          <defs>
            <Gradient definition={backgroundPaint.definition} />
          </defs>
        )}
        {/* White underneath: a background that resolves to nothing should look
            like paper rather than like whatever is behind the app. */}
        <rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={backgroundPaint.paint}
          fillOpacity={backgroundPaint.opacity}
        />
        <Guides guides={snapped.guides} slide={deck.slideSize} />

        {onSelect !== undefined && (
          // Catches a click that hit no shape, which is how a selection is
          // cleared. Behind everything, so a shape's own click wins.
          <rect
            data-testid="slide-background"
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onPointerDown={(event) => {
              if (drawing === null) {
                onSelect(null, false)
                onEdit?.(null)
                onOpenGroup?.(null)
              }
              if (onMarquee !== undefined || onDraw !== undefined) marquee.start(event)
            }}
          />
        )}
        {marquee.box !== null && (
          <rect
            data-testid="marquee"
            x={marquee.box.x}
            y={marquee.box.y}
            width={marquee.box.width}
            height={marquee.box.height}
            fill="var(--accent)"
            fillOpacity={drawing === null ? 0.12 : 0.25}
            stroke="var(--accent)"
            strokeWidth={2 * (width / 960)}
            pointerEvents="none"
          />
        )}
        {drawings.map((drawing) => (
          <Fragment key={drawing.key}>
            {playing && pkg !== undefined && (
              <ShapeLink
                drawing={drawing}
                pkg={pkg}
                deck={deck}
                part={slide.path}
                onFollow={onFollowLink}
              />
            )}
            {drawing.shape.kind === 'pic' && pkg !== undefined ? (
              <>
                <ShapeImage drawing={drawing} pkg={pkg} part={slide.path} />
                {playing && drawing.shape.media !== null && (
                  <MediaPlayer
                    drawing={drawing}
                    pkg={pkg}
                    part={slide.path}
                    autoplay={autoplay.has(drawing.shape.id)}
                  />
                )}
              </>
            ) : drawing.shape.graphic?.kind === 'chart' && pkg !== undefined ? (
              <ChartFrame drawing={drawing} pkg={pkg} part={slide.path} theme={theme} />
            ) : drawing.shape.graphic?.table != null ? (
              <TableView
                table={drawing.shape.graphic.table}
                x={drawing.transform.x}
                y={drawing.transform.y}
                context={drawing.context}
                style={styleFor(tableStyles, drawing.shape.graphic.table.properties.styleId)}
                selection={cells?.table === drawing.shape.id ? cells : null}
                onPickCell={
                  onPickCell === undefined
                    ? undefined
                    : (at, extend) => {
                        onSelect?.(drawing.shape.id, false)
                        onPickCell(drawing.shape.id, at, extend)
                      }
                }
              />
            ) : (
              <ShapeOutline drawing={drawing} />
            )}
            <ShapeText
              drawing={drawing}
              deck={deck}
              slide={slide}
              theme={theme}
              pkg={pkg}
              playing={playing}
              editing={editing === drawing.shape.id}
              onCommitText={onCommitText}
              onFollowLink={onFollowLink}
              onLeave={() => {
                onEdit?.(null)
              }}
            />
            {onSelect !== undefined && editing !== drawing.shape.id && (
              <rect
                // Over the shape and under the next one: an invisible target so
                // a shape with no fill is still clickable, which is how
                // PowerPoint behaves too.
                x={drawing.transform.x}
                y={drawing.transform.y}
                width={drawing.transform.width}
                height={drawing.transform.height}
                fill="transparent"
                role="button"
                aria-label={drawing.shape.name === '' ? 'Shape' : drawing.shape.name}
                onPointerDown={(event) => {
                  // What a click selects is not always what it hit: a member of
                  // a group selects the group, until the group has been opened.
                  const target = selectionTarget(drawing, openGroup)

                  // Clicking outside the open group is how you leave it.
                  if (
                    target.id !== drawing.shape.id &&
                    !drawing.ancestors.some((one) => one.id === openGroup)
                  ) {
                    onOpenGroup?.(null)
                  }

                  // Selecting first means a drag that starts on an unselected
                  // shape moves that shape, as it does everywhere else.
                  onSelect(target.id, event.shiftKey)
                  drag.start(event, null)
                }}
                onDoubleClick={() => {
                  const group = groupToOpen(drawing, openGroup)
                  if (group !== null) {
                    // Into the group rather than into the words: a double click
                    // on something grouped means "let me at the parts".
                    onOpenGroup?.(group)
                    onSelect(selectionTarget(drawing, group).id, false)
                    return
                  }

                  // A picture holds no text, so the obvious thing to do to one
                  // on a second click is to crop it — which is what PowerPoint
                  // does too.
                  if (drawing.shape.picture !== null) {
                    onCrop?.(drawing.shape.id)
                    return
                  }

                  // A shape with no text body can still be given one; a chart
                  // cannot hold text at all.
                  if (drawing.shape.kind === 'sp' || drawing.shape.kind === 'cxnSp') {
                    onEdit?.(drawing.shape.id)
                  }
                }}
              />
            )}
          </Fragment>
        ))}
        {selectedBoxes.map((drawing) =>
          drawing.shape.kind === 'cxnSp' ? (
            <ConnectorEnds
              key={`selected-${String(drawing.shape.id)}`}
              transform={shown(drawing)}
              onHandle={
                onDrag === undefined
                  ? undefined
                  : (event, handle) => {
                      drag.start(event, handle)
                    }
              }
            />
          ) : (
            <SelectionFrame
              key={`selected-${String(drawing.shape.id)}`}
              cropping={cropping === drawing.shape.id}
              transform={shown(drawing)}
              onHandle={
                onDrag === undefined
                  ? undefined
                  : (event, handle) => {
                      drag.start(event, handle)
                    }
              }
            />
          ),
        )}
      </svg>
    </div>
  )
}

/** The words PowerPoint shows in an empty placeholder of each kind. */
function promptFor(shape: Shape): string | null {
  switch (shape.placeholder?.type) {
    case 'title':
    case 'ctrTitle':
      return 'Click to add title'
    case 'subTitle':
      return 'Click to add subtitle'
    case undefined:
      // Not a placeholder: an empty text box a person made is empty on purpose.
      return null
    case 'dt':
    case 'ftr':
    case 'sldNum':
      // Filled by the show, not by typing, so a prompt would be a lie.
      return null
    default:
      return 'Click to add text'
  }
}

/**
 * The frame around a selected shape.
 *
 * Drawn after every shape so it is never hidden behind one, and sized in EMU
 * like everything else — the handles come out the right size because the
 * viewBox scales them with the slide.
 */
function SelectionFrame({
  transform,
  onHandle,
  cropping = false,
}: {
  transform: Transform
  onHandle?: (event: React.PointerEvent, handle: Handle) => void
  /** Drawn differently, and without the grip that turns the shape. */
  cropping?: boolean
}) {
  const handle = 76200
  const { x, y, width, height } = transform
  const middle = { x: x + width / 2, y: y + height / 2 }

  /** Where each handle sits: corners, then the middle of each edge. */
  const places: Record<SizingHandle, { x: number; y: number }> = {
    nw: { x, y },
    n: { x: middle.x, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: middle.y },
    se: { x: x + width, y: y + height },
    s: { x: middle.x, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: middle.y },
  }

  // Far enough above the shape to be grabbed without catching the top edge,
  // which is the handle right underneath it.
  const turn = { x: middle.x, y: y - handle * 2 }

  // The whole frame turns with the shape, so the handles stay on its corners
  // rather than on the corners of the box it would occupy unturned.
  const turned =
    transform.rotation === 0
      ? undefined
      : `rotate(${String(transform.rotation / 60000)} ${String(middle.x)} ${String(middle.y)})`

  return (
    <g data-testid="selection-frame" transform={turned}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="#FF7A00"
        strokeWidth={19050}
        pointerEvents="none"
      />

      {onHandle !== undefined && !cropping && (
        <g>
          <line
            x1={middle.x}
            y1={y}
            x2={turn.x}
            y2={turn.y}
            stroke="#FF7A00"
            strokeWidth={19050}
            pointerEvents="none"
          />
          <circle
            cx={turn.x}
            cy={turn.y}
            r={handle / 1.6}
            fill="#FFFFFF"
            stroke="#FF7A00"
            strokeWidth={19050}
            role="button"
            aria-label="Rotate"
            onPointerDown={(event) => {
              onHandle(event, 'rotate')
            }}
          />
        </g>
      )}

      {SIZING_HANDLES.map((corner) => {
        const at = places[corner]
        return (
          <rect
            key={`handle-${corner}`}
            x={at.x - handle / 2}
            y={at.y - handle / 2}
            width={handle}
            height={handle}
            fill={cropping ? '#111111' : '#FFFFFF'}
            stroke="#FF7A00"
            strokeWidth={19050}
            role={onHandle === undefined ? undefined : 'button'}
            aria-label={
              onHandle === undefined ? undefined : `${cropping ? 'Crop' : 'Resize'} ${corner}`
            }
            pointerEvents={onHandle === undefined ? 'none' : undefined}
            onPointerDown={(event) => {
              onHandle?.(event, corner)
            }}
          />
        )
      })}
    </g>
  )
}

/**
 * A selected connector: a grip at each end, and no box.
 *
 * A connector has no area, so eight sizing handles around the rectangle it
 * happens to span would offer eight ways to do the two things that mean
 * anything — move this end, move that one.
 */
function ConnectorEnds({
  transform,
  onHandle,
}: {
  transform: Transform
  onHandle?: (event: React.PointerEvent, handle: Handle) => void
}) {
  const grip = 76200
  const ends = connectorEnds(transform)

  return (
    <g data-testid="selection-frame">
      <line
        x1={ends.start.x}
        y1={ends.start.y}
        x2={ends.end.x}
        y2={ends.end.y}
        stroke="#FF7A00"
        strokeWidth={19050}
        pointerEvents="none"
      />
      {(['start', 'end'] as const).map((which) => (
        <circle
          key={which}
          cx={ends[which].x}
          cy={ends[which].y}
          r={grip / 1.6}
          fill="#FFFFFF"
          stroke="#FF7A00"
          strokeWidth={19050}
          role={onHandle === undefined ? undefined : 'button'}
          aria-label={onHandle === undefined ? undefined : `Connector ${which}`}
          pointerEvents={onHandle === undefined ? 'none' : undefined}
          onPointerDown={(event) => {
            onHandle?.(event, which === 'start' ? 'cxn-start' : 'cxn-end')
          }}
        />
      ))}
    </g>
  )
}

/** What a screen reader is told the slide is, taken from its own text. */
function slideLabel(slide: Slide): string {
  const title = flatten(slide.shapes).find((shape) => shape.placeholder?.type === 'title')
  const text = title?.text == null ? '' : textOfBody(title.text)
  return text === '' ? 'Slide' : `Slide: ${text}`
}
