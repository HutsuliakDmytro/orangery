import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { Deck, Slide } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { Theme } from '@orangery/ooxml-drawingml'
import { SlideView } from '../render/slide-view'

/**
 * A slide as a picture.
 *
 * The slide is drawn into a node that never reaches the window, by the same
 * renderer the canvas uses, and the SVG it produced is taken out of it. Drawing
 * it a second way to export it would be a second way of drawing it wrongly, and
 * taking it out of the window instead would mean exporting whatever happened to
 * be on screen — including a selection outline.
 *
 * Pictures inside are already data URLs, so the file stands on its own. Fonts
 * are named and not embedded: a viewer without Inter falls back to whatever it
 * has, which is the one thing about an exported SVG that is not what you saw.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

/** Renders one slide and gives back the SVG markup, standing alone. */
export function slideSvg(
  deck: Deck,
  slide: Slide,
  themes: Map<string, Theme>,
  pkg: OoxmlPackage,
): string {
  const host = document.createElement('div')
  const root = createRoot(host)

  try {
    // Synchronously, because the markup is read on the next line.
    flushSync(() => {
      root.render(<SlideView deck={deck} slide={slide} themes={themes} package={pkg} />)
    })

    const svg = host.querySelector('svg')
    if (svg === null) throw new Error('the slide produced no drawing')

    // A file has to carry the namespaces the document around it was giving it.
    svg.setAttribute('xmlns', SVG_NAMESPACE)
    svg.setAttribute('xmlns:xlink', XLINK_NAMESPACE)
    svg.setAttribute('width', String(deck.slideSize.width))
    svg.setAttribute('height', String(deck.slideSize.height))

    return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}`
  } finally {
    root.unmount()
  }
}

export type RasterType = 'image/png' | 'image/jpeg'

/**
 * Turns the markup into pixels, through the browser that drew it.
 *
 * The text of a slide is HTML inside a `foreignObject`, and whether an engine
 * will rasterise that out of an `<img>` is a question about the engine. So a
 * failure here is reported rather than written: a blank PNG that saved without
 * complaint is worse than one that did not save.
 */
export async function rasterise(
  markup: string,
  size: { width: number; height: number },
  type: RasterType,
  scale = 1,
): Promise<Uint8Array> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const loading = new Image()
    loading.addEventListener('load', () => {
      resolve(loading)
    })
    loading.addEventListener('error', () => {
      reject(new Error('this slide could not be turned into a picture'))
    })
    loading.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(size.width * scale), 1)
  canvas.height = Math.max(Math.round(size.height * scale), 1)

  const context = canvas.getContext('2d')
  if (context === null) throw new Error('this build cannot draw pictures')

  // JPEG has no transparency, and a slide drawn onto nothing comes out black.
  if (type === 'image/jpeg') {
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.92 : undefined)
  })
  if (blob === null) throw new Error('this slide could not be turned into a picture')

  return new Uint8Array(await blob.arrayBuffer())
}

/** `Deck-03.png`, numbered from one and padded so a directory sorts. */
export function pictureName(deckName: string, index: number, count: number, extension: string) {
  const stem = deckName.replace(/\.pptx$/iu, '')
  const width = String(count).length

  return `${stem}-${String(index + 1).padStart(width, '0')}.${extension}`
}
