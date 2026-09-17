import { Fragment } from 'react'
import {
  absoluteTransform,
  backgroundOf,
  colorContextFor,
  flatten,
  listStyleChain,
  lookContext,
  resolveParagraphProperties,
  resolveRunProperties,
  resolveTransform,
  shapeLook,
  relationshipTarget,
  withAncestors,
} from '@orangery/ooxml-presentation'
import type { Deck, Shape, Slide, Transform } from '@orangery/ooxml-presentation'
import { getPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import {
  EMU_PER_POINT,
  fontStackFor,
  readChart,
  resolveThemeFont,
  textOfBody,
} from '@orangery/ooxml-drawingml'
import type { ColorContext, Theme } from '@orangery/ooxml-drawingml'
import { fillPaint, linePaint } from './paint'
import { mediaUrl } from './media'
import { TableView } from './table-view'
import { ChartView } from './chart-view'
import type { GradientDefinition } from './paint'
import { isLinePreset, pathFor } from './geometry'

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

/** A slide is drawn at its own size and scaled by CSS, so one unit is one EMU. */
interface Drawing {
  shape: Shape
  transform: Transform
  look: ReturnType<typeof shapeLook>
  context: ColorContext
  key: string
}

function drawingsFor(deck: Deck, slide: Slide, theme: Theme | undefined, base: ColorContext) {
  return withAncestors(slide.shapes).flatMap(({ shape, ancestors }, index): Drawing[] => {
    // A group is a coordinate space, not something drawn; its children are.
    if (shape.kind === 'grpSp') return []

    const stated = shape.transform ?? resolveTransform(deck, slide, shape)
    const transform = absoluteTransform(stated, ancestors)
    if (transform === null) return []

    const look = shapeLook(shape, theme)
    return [
      {
        shape,
        transform,
        look,
        context: lookContext(base, look),
        key: `${String(shape.id)}-${String(index)}`,
      },
    ]
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

  const path = pathFor(preset, { width: transform.width, height: transform.height })
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
}: {
  drawing: Drawing
  deck: Deck
  slide: Slide
  theme: Theme | undefined
}) {
  const { shape, transform, context } = drawing
  if (shape.text === null || textOfBody(shape.text) === '') return null

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
        {shape.text.paragraphs.map((paragraph, index) => {
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
        })}
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
  className,
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
  className?: string
}) {
  const base = colorContextFor(deck, themes, slide)
  const master = [...deck.masters.values()][0]
  const theme = master?.theme == null ? undefined : themes.get(master.theme)
  const drawings = drawingsFor(deck, slide, theme, base)

  const { width, height } = deck.slideSize
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
      style={{ position: 'relative', aspectRatio: `${String(width)} / ${String(height)}` }}
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
            <ShapeText drawing={drawing} deck={deck} slide={slide} theme={theme} />
            {onSelect !== undefined && (
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
                  event.stopPropagation()
                  onSelect(drawing.shape.id, event.shiftKey)
                }}
              />
            )}
          </Fragment>
        ))}
        {drawings
          .filter((drawing) => selection?.includes(drawing.shape.id) === true)
          .map((drawing) => (
            <SelectionFrame key={`selected-${drawing.key}`} transform={drawing.transform} />
          ))}
      </svg>
    </div>
  )
}

/**
 * The frame around a selected shape.
 *
 * Drawn after every shape so it is never hidden behind one, and sized in EMU
 * like everything else — the handles come out the right size because the
 * viewBox scales them with the slide.
 */
function SelectionFrame({ transform }: { transform: Transform }) {
  const handle = 76200
  const corners = [
    [transform.x, transform.y],
    [transform.x + transform.width, transform.y],
    [transform.x, transform.y + transform.height],
    [transform.x + transform.width, transform.y + transform.height],
  ] as const

  return (
    <g pointerEvents="none">
      <rect
        x={transform.x}
        y={transform.y}
        width={transform.width}
        height={transform.height}
        fill="none"
        stroke="#FF7A00"
        strokeWidth={19050}
      />
      {corners.map(([x, y]) => (
        <rect
          key={`${String(x)},${String(y)}`}
          x={x - handle / 2}
          y={y - handle / 2}
          width={handle}
          height={handle}
          fill="#FFFFFF"
          stroke="#FF7A00"
          strokeWidth={19050}
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
