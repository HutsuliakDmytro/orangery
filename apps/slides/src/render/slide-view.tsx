import { Fragment } from 'react'
import {
  absoluteTransform,
  backgroundOf,
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
} from '@orangery/ooxml-presentation'
import type { Deck, Shape, Slide, SlidePart, Transform } from '@orangery/ooxml-presentation'
import { getPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import {
  EMU_PER_POINT,
  fontStackFor,
  toSvgPath,
  readChart,
  resolveThemeFont,
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
import { applyDrag, useDrag } from './use-drag'
import { boundsOf, correct, correctionBetween, NO_CORRECTION, snapRect } from './snap'
import type { Correction, Guide } from './snap'
import { TextEditor } from './text-editor'
import type { DragState, Handle } from './use-drag'

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
      <image
        href={url}
        x={-left * width}
        y={-top * height}
        width={width}
        height={height}
        preserveAspectRatio="none"
        clipPath={`url(#clip-${key})`}
      />
    </g>
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
  const rotation =
    transform.rotation === 0
      ? undefined
      : `rotate(${String(transform.rotation / 60000)} ${String(transform.width / 2)} ${String(
          transform.height / 2,
        )})`

  return (
    <g transform={`translate(${String(transform.x)} ${String(transform.y)})`}>
      {fill.definition && (
        <defs>
          <Gradient definition={fill.definition} />
        </defs>
      )}
      <g transform={rotation}>
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
  editing,
  onCommitText,
  onLeave,
}: {
  drawing: Drawing
  deck: Deck
  slide: Slide
  theme: Theme | undefined
  editing?: boolean
  onCommitText?: (id: number, doc: PmNode) => void
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

                  return (
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
  editing,
  onEdit,
  onCommitText,
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
  /** The shape whose text is open for editing. */
  editing?: number | null
  /** Asked to enter a shape's text, or to leave it with `null`. */
  onEdit?: (id: number | null) => void
  /** The edited document, handed over when the shape is left. */
  onCommitText?: (id: number, doc: PmNode) => void
  className?: string
  style?: React.CSSProperties
}) {
  const base = colorContextFor(deck, themes, slide)
  const master = [...deck.masters.values()][0]
  const theme = master?.theme == null ? undefined : themes.get(master.theme)
  const drawings = drawingsFor(deck, slide, theme, base)

  const { width, height } = deck.slideSize

  /**
   * What snapping would add to the drag as it stands, and the lines saying why.
   *
   * Computed from the rectangle around the whole selection rather than shape by
   * shape: dragging three boxes moves one thing, and snapping each of them
   * separately would pull them apart.
   */
  const snapFor = (state: DragState | null) => {
    if (state === null || selection === undefined) return { correction: NO_CORRECTION, guides: [] }

    const selected = drawings.filter((one) => selection.includes(one.shape.id))
    const bounds = boundsOf(selected.map((one) => one.transform))
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

  const drag = useDrag({
    slideWidth: width,
    onCommit: (state) => {
      onDrag?.(state, snapFor(state).correction)
    },
  })

  const snapped = snapFor(drag.state)

  /** While dragging, the selection is drawn where it is being taken. */
  const shown = (drawing: Drawing): Transform => {
    if (drag.state === null || selection?.includes(drawing.shape.id) !== true) {
      return drawing.transform
    }
    return {
      ...drawing.transform,
      ...correct(applyDrag(drawing.transform, drag.state), snapped.correction),
    }
  }

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
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onPointerDown={() => {
              onSelect(null, false)
              onEdit?.(null)
            }}
          />
        )}
        {drawings.map((drawing) => (
          <Fragment key={drawing.key}>
            {drawing.shape.kind === 'pic' && pkg !== undefined ? (
              <ShapeImage drawing={drawing} pkg={pkg} part={slide.path} />
            ) : drawing.shape.graphic?.kind === 'chart' && pkg !== undefined ? (
              <ChartFrame drawing={drawing} pkg={pkg} part={slide.path} theme={theme} />
            ) : drawing.shape.graphic?.table != null ? (
              <TableView
                table={drawing.shape.graphic.table}
                x={drawing.transform.x}
                y={drawing.transform.y}
                context={drawing.context}
              />
            ) : (
              <ShapeOutline drawing={drawing} />
            )}
            <ShapeText
              drawing={drawing}
              deck={deck}
              slide={slide}
              theme={theme}
              editing={editing === drawing.shape.id}
              onCommitText={onCommitText}
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
                  // Selecting first means a drag that starts on an unselected
                  // shape moves that shape, as it does everywhere else.
                  onSelect(drawing.shape.id, event.shiftKey)
                  drag.start(event, null)
                }}
                onDoubleClick={() => {
                  // A shape with no text body can still be given one; a picture
                  // or a chart cannot hold text at all.
                  if (drawing.shape.kind === 'sp' || drawing.shape.kind === 'cxnSp') {
                    onEdit?.(drawing.shape.id)
                  }
                }}
              />
            )}
          </Fragment>
        ))}
        {drawings
          .filter((drawing) => selection?.includes(drawing.shape.id) === true)
          .map((drawing) => (
            <SelectionFrame
              key={`selected-${drawing.key}`}
              transform={shown(drawing)}
              onHandle={
                onDrag === undefined
                  ? undefined
                  : (event, handle) => {
                      drag.start(event, handle)
                    }
              }
            />
          ))}
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
}: {
  transform: Transform
  onHandle?: (event: React.PointerEvent, handle: Handle) => void
}) {
  const handle = 76200
  const corners = [
    ['nw', transform.x, transform.y],
    ['ne', transform.x + transform.width, transform.y],
    ['sw', transform.x, transform.y + transform.height],
    ['se', transform.x + transform.width, transform.y + transform.height],
  ] as const

  return (
    <g>
      <rect
        x={transform.x}
        y={transform.y}
        width={transform.width}
        height={transform.height}
        fill="none"
        stroke="#FF7A00"
        strokeWidth={19050}
        pointerEvents="none"
      />
      {corners.map(([corner, x, y]) => (
        <rect
          key={corner}
          x={x - handle / 2}
          y={y - handle / 2}
          width={handle}
          height={handle}
          fill="#FFFFFF"
          stroke="#FF7A00"
          strokeWidth={19050}
          role={onHandle === undefined ? undefined : 'button'}
          aria-label={onHandle === undefined ? undefined : `Resize ${corner}`}
          pointerEvents={onHandle === undefined ? 'none' : undefined}
          onPointerDown={(event) => {
            onHandle?.(event, corner)
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
