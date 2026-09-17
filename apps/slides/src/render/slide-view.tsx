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
  withAncestors,
} from '@orangery/ooxml-presentation'
import type { Deck, Shape, Slide, Transform } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import {
  EMU_PER_POINT,
  fontStackFor,
  resolveThemeFont,
  textOfBody,
} from '@orangery/ooxml-drawingml'
import type { ColorContext, Theme } from '@orangery/ooxml-drawingml'
import { fillPaint, linePaint } from './paint'
import { mediaUrl } from './media'
import { TableView } from './table-view'
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
                  properties.lineSpacing?.kind === 'percent' ? properties.lineSpacing.value : 1.2,
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
                      fontSize: (resolved?.size ?? 18) * EMU_PER_POINT,
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
  className,
}: {
  deck: Deck
  slide: Slide
  themes: ReadonlyMap<string, Theme>
  /** Needed for the media a picture points at, which lives in the zip. */
  package?: OoxmlPackage
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
        {drawings.map((drawing) => (
          <Fragment key={drawing.key}>
            {drawing.shape.kind === 'pic' && pkg !== undefined ? (
              <ShapeImage drawing={drawing} pkg={pkg} part={slide.path} />
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
          </Fragment>
        ))}
      </svg>
    </div>
  )
}

/** What a screen reader is told the slide is, taken from its own text. */
function slideLabel(slide: Slide): string {
  const title = flatten(slide.shapes).find((shape) => shape.placeholder?.type === 'title')
  const text = title?.text == null ? '' : textOfBody(title.text)
  return text === '' ? 'Slide' : `Slide: ${text}`
}
