import {
  addSlide,
  createDeck,
  createShape,
  deleteShapes,
  flatten,
  insertPicture,
  readDeck,
  readPptxPackage,
  readSlidePart,
  saveDeck,
  setShapeText,
  setSlideLayout,
  setSlideSize,
  slideName,
  UnsupportedPictureError,
  writeFill,
  writeLine,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import type { Deck, SlidePart, TextLine } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { OdpDeck, OdpPage } from './odp-read'

/**
 * Building a deck out of what an ODP said.
 *
 * Every page lands on the Blank layout with its frames placed where the file
 * put them, rather than being fitted to our title and body placeholders. An
 * import should show what the file says. Mapping a frame onto a placeholder
 * would re-flow it to our master's idea of where a title goes, which is a
 * different deck wearing the same words.
 */

const BLANK = 'Blank'

function layoutNamed(deck: Deck, name: string): SlidePart | null {
  const layouts = [...deck.layouts.values()]
  return layouts.find((layout) => slideName(layout) === name) ?? layouts[0] ?? null
}

/**
 * Puts one page's frames onto a slide that is already there.
 *
 * In two passes over the part, because creating a shape adds it to the XML and
 * not to the shapes that XML was parsed into — so the text has to be written
 * against a fresh reading, or it would be written to nothing and the frame
 * would arrive empty.
 */
function fill(pkg: OoxmlPackage, slide: SlidePart, page: OdpPage): number {
  let lost = 0
  const written: { id: number; lines: TextLine[] }[] = []

  for (const shape of page.shapes) {
    const transform = { x: shape.x, y: shape.y, width: shape.width, height: shape.height }

    if (shape.kind === 'picture') {
      try {
        insertPicture(pkg, slide, { fileName: shape.name, bytes: shape.bytes, transform })
      } catch (cause) {
        // A format a deck cannot hold — WMF, or something Impress invented.
        // Counted rather than thrown: one odd picture is not a reason to refuse
        // the other forty slides.
        if (!(cause instanceof UnsupportedPictureError)) throw cause
        lost += 1
      }
      continue
    }

    written.push({ id: createShape(slide, { preset: 'rect', transform }), lines: shape.lines })
  }

  writeSlidePart(pkg, slide)
  const again = readSlidePart(pkg, slide.path)
  if (again === null) return lost + written.length

  for (const { id, lines } of written) {
    const made = flatten(again.shapes).find((one) => one.id === id)
    if (made === undefined) {
      lost += 1
      continue
    }

    // A text frame in a presentation is words, not a box. `createShape` makes
    // something drawn, which is right for a shape somebody drew and wrong for
    // one that only ever held text.
    writeFill(made, { kind: 'none' })
    writeLine(made, { fill: { kind: 'none' } })
    setShapeText(made, lines)
  }

  writeSlidePart(pkg, again)
  return lost
}

export interface ImportedOdp {
  bytes: Uint8Array
  /** How much of the file did not come across, for the banner. */
  skipped: number
}

/**
 * An ODP as a real `.pptx`, ready to open.
 *
 * Bytes rather than a package, for the same reason a new deck is bytes: what
 * the caller does with it is open it, and opening is reading a deck.
 */
export async function deckFromOdp(odp: OdpDeck): Promise<ImportedOdp> {
  const pkg = await readPptxPackage(await createDeck())
  let lost = odp.skipped

  if (odp.size !== null) {
    setSlideSize(pkg, readDeck(pkg), odp.size, 'fit')
  }

  // The deck starts with the one slide `createDeck` makes; the rest are added
  // beside it, all on Blank.
  for (let index = 0; index < Math.max(odp.pages.length, 1); index += 1) {
    const deck = readDeck(pkg)
    const blank = layoutNamed(deck, BLANK)
    if (blank === null) break

    if (index === 0) {
      const first = deck.slides[0]
      if (first === undefined) continue

      if (first.layout !== blank.path) setSlideLayout(pkg, first, blank)

      // And empty it. Pointing a slide at a different layout does not take away
      // the shapes the old one put on it, so the title and subtitle boxes
      // `createDeck` starts with would sit on every imported page, empty,
      // in front of the frames the file actually described.
      if (deleteShapes(first, first.shapes)) writeSlidePart(pkg, first)
      continue
    }

    addSlide(pkg, deck, blank, index - 1)
  }

  // Filled over the deck as it finally stands: adding a slide re-reads the
  // package, and a shape held from before that belongs to a parse nobody is
  // looking at any more.
  const deck = readDeck(pkg)
  for (const [index, page] of odp.pages.entries()) {
    const slide = deck.slides[index]
    if (slide === undefined) continue

    lost += fill(pkg, slide, page)
  }

  return { bytes: await saveDeck(pkg), skipped: lost }
}
