import { findChild } from '@orangery/ooxml-core'
import { flatten } from '@orangery/ooxml-presentation'
import type { Deck, Shape, Slide } from '@orangery/ooxml-presentation'
import { isKnownPreset } from '../render/geometry'

/**
 * What the deck contains that we cannot show faithfully.
 *
 * Nothing here is lost — every one of these is preserved and written back
 * untouched (`docs/adr/0002-pptx-roundtrip.md`). The point of saying so is that
 * a person editing a deck should know which parts of what they see are
 * approximate, rather than discovering it when they present.
 *
 * Collected by walking the deck rather than recorded while parsing: the parser
 * has no opinion about what a renderer can draw, and keeping the two apart
 * means adding a preset to the renderer removes a warning without touching the
 * OOXML layer.
 */

export interface Warning {
  /** Grouped in the banner, so one message covers forty shapes. */
  kind: string
  message: string
  /** One-based, as a person counts slides. */
  slides: number[]
}

interface Finding {
  kind: string
  message: string
  slide: number
}

function findingsFor(shape: Shape, slide: number): Finding[] {
  const found: Finding[] = []

  if (shape.kind === 'unknown') {
    found.push({ kind: 'shape', message: 'A shape of a kind we do not draw', slide })
  }

  const graphic = shape.graphic?.kind
  if (graphic === 'chart') {
    // Drawn from the values cached in the chart part, which is what PowerPoint
    // draws from too — but without its styling, so it is worth mentioning.
    found.push({ kind: 'chart', message: 'Charts are drawn simply, without their styling', slide })
  }
  if (graphic === 'diagram') {
    found.push({ kind: 'diagram', message: 'SmartArt is shown as an empty frame', slide })
  }
  if (graphic === 'ole' || graphic === 'unknown') {
    found.push({ kind: 'embedded', message: 'An embedded object is not shown', slide })
  }

  const preset = shape.properties?.geometry
  if (preset?.kind === 'custom') {
    // Its own outlines are drawn now; only one holding an arc falls back to the
    // box it sits in, and only that is worth saying.
    if (preset.paths === null) {
      found.push({ kind: 'geometry', message: 'A custom shape is drawn as a rectangle', slide })
    }
  } else if (preset != null && !isKnownPreset(preset.preset)) {
    found.push({ kind: 'geometry', message: 'Some shapes are drawn as rectangles', slide })
  }

  if (shape.properties?.fill?.kind === 'picture') {
    found.push({ kind: 'fill', message: 'A picture used as a fill is not shown', slide })
  }

  return found
}

/** True when the slide carries animation timing, which MVP preserves but does not play. */
function hasAnimations(slide: Slide): boolean {
  const timing = findChild(slide.root, 'p:timing')
  return timing !== undefined
}

export function inspect(deck: Deck): Warning[] {
  const findings = deck.slides.flatMap((slide, index) => {
    const number = index + 1
    const shapes = flatten(slide.shapes).flatMap((shape) => findingsFor(shape, number))

    return hasAnimations(slide)
      ? [
          ...shapes,
          {
            kind: 'animation',
            message: 'Animations are kept in the file but do not play here',
            slide: number,
          },
        ]
      : shapes
  })

  const grouped = new Map<string, Warning>()
  for (const finding of findings) {
    const existing = grouped.get(finding.message)
    if (existing === undefined) {
      grouped.set(finding.message, {
        kind: finding.kind,
        message: finding.message,
        slides: [finding.slide],
      })
      continue
    }
    if (!existing.slides.includes(finding.slide)) existing.slides.push(finding.slide)
  }

  return [...grouped.values()]
}

/** "slide 3" / "slides 3, 7 and 9" / "12 slides", for a message a person reads. */
export function describeSlides(slides: readonly number[]): string {
  if (slides.length === 1) return `slide ${String(slides[0])}`
  if (slides.length > 4) return `${String(slides.length)} slides`

  const listed = slides.map(String)
  const last = listed[listed.length - 1] ?? ''
  return `slides ${listed.slice(0, -1).join(', ')} and ${last}`
}
