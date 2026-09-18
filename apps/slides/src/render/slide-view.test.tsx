import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  applyFooters,
  moveSlide,
  NO_FOOTERS,
  readDeck,
  readPptxPackage,
  readThemes,
  saveDeck,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import { readBodyProperties } from '@orangery/ooxml-drawingml'
import {
  getPartText,
  parseRelationships,
  parseXml,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import { SlideView } from './slide-view'

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function open(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (!slide) throw new Error('fixture has no slides')

  return { deck, slide, themes: readThemes(pkg, deck), pkg }
}

const draw = async (name: string) => {
  const { deck, slide, themes } = await open(name)
  return render(<SlideView deck={deck} slide={slide} themes={themes} />)
}

const paths = (container: HTMLElement) => [...container.querySelectorAll('path')]

describe('the canvas', () => {
  it("uses the deck's own slide size as the coordinate space", async () => {
    const { container } = await draw('sixteen-by-nine')
    const svg = container.querySelector('svg')

    // EMU throughout: converting here would make every position a rounding.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 12192000 6858000')
  })

  it('keeps the slide proportions whatever it is scaled to', async () => {
    const { container } = await draw('empty')
    const frame = screen.getByTestId('slide')

    expect(frame.style.aspectRatio).toBe('9144000 / 6858000')
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('names the slide by its title, for anyone reading by ear', async () => {
    await draw('placeholders')
    expect(screen.getByRole('img', { name: 'Slide: Placeholder inheritance' })).toBeInTheDocument()
  })
})

describe('shapes', () => {
  it('draws one path per shape, in document order', async () => {
    const { container } = await draw('shapes')
    expect(paths(container)).toHaveLength(4)
  })

  it('fills a shape with the colour it states', async () => {
    const { container } = await draw('shapes')
    const [first] = paths(container)

    expect(first?.getAttribute('fill')).toBe('#161616')
    expect(first?.getAttribute('stroke')).toBe('#FF7A00')
  })

  it('fills a shape that states none from the theme it points at', async () => {
    // These draw blank without the format scheme, which is most shapes from a
    // template.
    const { container } = await draw('groups-and-connectors')
    const rounded = paths(container)[0]

    expect(rounded?.getAttribute('fill')).toMatch(/^url\(#/u)
    expect(container.querySelector('linearGradient')).toBeInTheDocument()
  })

  it('puts a grouped shape where the group puts it, not where it says', async () => {
    const { container } = await draw('groups-and-connectors')
    const groups = [...container.querySelectorAll('g[transform^="translate"]')]
    const translations = groups.map((group) => group.getAttribute('transform'))

    // The rectangle inside the group states x=914400 and belongs at 4572000.
    expect(translations).toContain('translate(4572000 3657600)')
    expect(translations).not.toContain('translate(914400 3657600)')
  })

  it('draws a line preset with a stroke and no fill', async () => {
    const { container } = await draw('groups-and-connectors')
    const line = paths(container).find((path) => path.getAttribute('fill') === 'none')

    expect(line).toBeDefined()
    expect(line?.getAttribute('stroke')).not.toBe('none')
  })
})

describe('text', () => {
  it('draws the runs a shape holds', async () => {
    await draw('text-formatting')

    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.getByText('orange')).toBeInTheDocument()
  })

  it('gives each run the formatting it states', async () => {
    await draw('text-formatting')

    expect(screen.getByText('bold')).toHaveStyle({ fontWeight: '700' })
    expect(screen.getByText('italic')).toHaveStyle({ fontStyle: 'italic' })
    expect(screen.getByText('orange')).toHaveStyle({ color: 'rgb(255, 122, 0)' })
  })

  it('gives a placeholder the size it inherits rather than a default', async () => {
    // The slide states nothing; 44pt comes from the master's title style.
    await draw('placeholders')
    const title = screen.getByText('Placeholder inheritance')

    expect(title).toHaveStyle({ fontSize: `${String(44 * 12700)}px` })
  })

  it('wraps text in a foreignObject, since SVG text cannot wrap', async () => {
    const { container } = await draw('text-formatting')
    expect(container.querySelector('foreignObject')).toBeInTheDocument()
  })

  it('draws nothing for a shape with no text', async () => {
    const { container } = await draw('picture')
    expect(container.querySelector('foreignObject')).not.toBeInTheDocument()
  })
})

describe('the background', () => {
  it('comes from the master when the slide states none', async () => {
    // Every slide in the corpus inherits it; reading only the slide paints
    // everything white by accident rather than on purpose.
    const { container } = await draw('empty')
    const backgrounds = [...container.querySelectorAll('svg > rect')]

    expect(backgrounds).toHaveLength(2)
    expect(backgrounds[1]?.getAttribute('fill')).toBe('#FFFFFF')
  })
})

describe('pictures', () => {
  it('draws the image the relationship points at', async () => {
    const { deck, slide, themes, pkg } = await open('picture')
    const { container } = render(
      <SlideView deck={deck} slide={slide} themes={themes} package={pkg} />,
    )
    const image = container.querySelector('image')

    expect(image?.getAttribute('href')).toMatch(/^data:image\/png;base64,/u)
    expect(image?.getAttribute('width')).toBe('812800')
  })

  it('draws nothing where the package was not given', async () => {
    // The filmstrip and the canvas both pass it; a caller that does not should
    // show an empty frame rather than a broken image.
    const { container } = await draw('picture')
    expect(container.querySelector('image')).not.toBeInTheDocument()
  })
})

describe('tables', () => {
  it('draws a cell for every one the grid shows', async () => {
    const { container } = await draw('table')
    const cells = [...container.querySelectorAll('foreignObject')]

    // Three by three, plus the title placeholder's own text.
    expect(cells.length).toBeGreaterThanOrEqual(9)
  })

  it('puts the cell text in it', async () => {
    await draw('table')

    expect(screen.getByText('Head 1')).toBeInTheDocument()
    expect(screen.getByText('r2c2')).toBeInTheDocument()
  })

  it('lays the columns out from the grid widths', async () => {
    const { container } = await draw('table')
    const rects = [...container.querySelectorAll('rect')].filter(
      (rect) => rect.getAttribute('width') === '2438400',
    )

    expect(rects.length).toBeGreaterThanOrEqual(3)
  })
})

describe('autofit', () => {
  const withAutofit = async (bodyPr: string) => {
    const { deck, slide, themes } = await open('text-formatting')
    const box = slide.shapes[0]
    if (box?.text?.bodyProperties == null) throw new Error('fixture changed')

    // The fixture states no autofit, so the state under test is set here rather
    // than kept as a second .pptx that differs in one attribute.
    const parsed = readBodyProperties(parseXml(bodyPr)[0] ?? {})
    const patched = {
      ...slide,
      shapes: [{ ...box, text: { ...box.text, bodyProperties: parsed } }, ...slide.shapes.slice(1)],
    }

    return render(<SlideView deck={deck} slide={patched} themes={themes} />)
  }

  it('draws text at the size PowerPoint shrank it to', async () => {
    // Ignoring fontScale overflows the shape in exactly the way PowerPoint
    // already decided it should not.
    await withAutofit('<a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>')

    expect(screen.getByText('large')).toHaveStyle({ fontSize: `${String(32 * 12700 * 0.5)}px` })
  })

  it('tightens the lines by what was recorded with it', async () => {
    // Relative to the untightened render, because the line height itself is
    // inherited and this test is about the reduction, not about the base.
    const lineHeightOf = (container: HTMLElement) =>
      Number(
        container
          .querySelector('foreignObject p')
          ?.getAttribute('style')
          ?.match(/line-height:\s*([\d.]+)/u)?.[1],
      )

    const plain = await withAutofit('<a:bodyPr><a:normAutofit fontScale="100000"/></a:bodyPr>')
    const base = lineHeightOf(plain.container)
    cleanup()

    const tightened = await withAutofit(
      '<a:bodyPr><a:normAutofit fontScale="100000" lnSpcReduction="20000"/></a:bodyPr>',
    )

    expect(base).toBeGreaterThan(0)
    expect(lineHeightOf(tightened.container)).toBeCloseTo(base * 0.8, 5)
  })

  it('leaves text alone where autofit is off', async () => {
    await withAutofit('<a:bodyPr><a:noAutofit/></a:bodyPr>')
    expect(screen.getByText('large')).toHaveStyle({ fontSize: `${String(32 * 12700)}px` })
  })
})

describe('charts', () => {
  const drawCharts = async () => {
    const { deck, slide, themes, pkg } = await open('charts')
    return render(<SlideView deck={deck} slide={slide} themes={themes} package={pkg} />)
  }

  it('draws one chart per frame on the slide', async () => {
    const { container } = await drawCharts()
    // The slide's own svg, plus one nested per chart.
    expect(container.querySelectorAll('svg')).toHaveLength(4)
  })

  it('draws a bar per point of every series', async () => {
    const { container } = await drawCharts()
    const chart = container.querySelectorAll('svg')[1]
    const bars = [...(chart?.querySelectorAll('rect') ?? [])].filter(
      (rect) => rect.getAttribute('fill') !== '#FFFFFF',
    )

    // Two series of four, plus a legend swatch each.
    expect(bars.length).toBeGreaterThanOrEqual(8)
  })

  it('draws a line chart as paths rather than bars', async () => {
    const { container } = await drawCharts()
    const chart = container.querySelectorAll('svg')[2]

    expect(chart?.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('names the chart for anyone reading by ear', async () => {
    await drawCharts()
    expect(screen.getAllByRole('img', { name: 'Chart' }).length).toBe(3)
  })

  it('draws nothing where the chart part cannot be reached', async () => {
    // No package, no chart part; the slide still renders.
    const { container } = await draw('charts')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })
})

describe('what the layout and the master draw behind the slide', () => {
  /** Puts a shape with no placeholder on the master, the way a logo sits there. */
  async function withFurniture(hidden = false) {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))

    const masterPath = [...pkg.parts.keys()].find((path) =>
      path.startsWith('ppt/slideMasters/slideMaster'),
    )
    if (masterPath === undefined) throw new Error('fixture has no master')

    const furniture =
      '<p:sp><p:nvSpPr><p:cNvPr id="99" name="Logo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>'

    const master = getPartText(pkg, masterPath) ?? ''
    setPartText(pkg, masterPath, master.replace('</p:spTree>', `${furniture}</p:spTree>`))

    if (hidden) {
      const slide = getPartText(pkg, 'ppt/slides/slide1.xml') ?? ''
      setPartText(
        pkg,
        'ppt/slides/slide1.xml',
        slide.replace('<p:sld ', '<p:sld showMasterSp="0" '),
      )
    }

    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('lost the slide')

    return render(<SlideView deck={deck} slide={slide} themes={readThemes(pkg, deck)} />)
  }

  it('draws the furniture the master carries', async () => {
    const plain = await draw('empty')
    const before = paths(plain.container).length
    cleanup()

    const { container } = await withFurniture()
    expect(paths(container).length).toBe(before + 1)
  })

  it('draws none of it when the slide hides background graphics', async () => {
    const shown = await withFurniture()
    const drawn = paths(shown.container).length
    cleanup()

    const { container } = await withFurniture(true)
    expect(paths(container).length).toBeLessThan(drawn)
  })

  it("leaves the layout's placeholders out, which are templates and not content", async () => {
    // Drawing them would show every slide its layout's "Click to add title".
    const { container } = await withFurniture()
    expect(container.textContent).not.toContain('Click to add')
  })
})

describe('a shape the file hides', () => {
  it('is left off the slide, and takes nothing beside it with it', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'animations.pptx')))
    const deck = readDeck(pkg)
    const slide = deck.slides[1]
    if (slide === undefined) throw new Error('fixture changed')

    const { container } = render(
      <SlideView deck={deck} slide={slide} themes={readThemes(pkg, deck)} />,
    )

    expect(container.textContent).toContain('Shown')
    expect(container.textContent).not.toContain('Not shown')
  })
})

describe('the fields on a slide', () => {
  /** The text of the slide-number placeholder, which is the only one drawn bare. */
  const numberShown = (container: HTMLElement) =>
    [...container.querySelectorAll('foreignObject')]
      .map((box) => box.textContent)
      .find((text) => /^\d+$/u.test(text)) ?? null

  /** Puts the date and the number on every slide, then reopens the deck. */
  async function withFooters() {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    const deck = readDeck(pkg)
    applyFooters(
      deck,
      deck.slides,
      { ...NO_FOOTERS, date: true, slideNumber: true },
      { now: new Date(2020, 0, 1), locale: 'en-US' },
    )
    for (const slide of deck.slides) writeSlidePart(pkg, slide)

    const reopened = await readPptxPackage(await saveDeck(pkg))
    return { deck: readDeck(reopened), pkg: reopened }
  }

  it('numbers the slide it is drawn on, not the one the file remembers', async () => {
    const { pkg } = await withFooters()

    // The third slide, moved to the front after its number was written into it:
    // the file says 3 and the deck says 1, which is the whole point of drawing
    // the field rather than its cache.
    moveSlide(pkg, 2, 0)
    const reordered = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const moved = reordered.slides[0]
    if (moved === undefined) throw new Error('fixture is too short')

    const { container } = render(
      <SlideView deck={reordered} slide={moved} themes={readThemes(pkg, reordered)} />,
    )

    // Its title still says what it always said, so the two are told apart.
    expect(container.textContent).toContain('Slide 3')
    expect(numberShown(container)).toBe('1')
  })

  it('shows the day it is being looked at, not the day it was saved', async () => {
    const { deck, pkg } = await withFooters()
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    const { container } = render(
      <SlideView deck={deck} slide={first} themes={readThemes(pkg, deck)} />,
    )

    // Cached as the first of January 2020, which is a date nobody is reading it on.
    expect(container.textContent).not.toContain('2020')
    expect(container.textContent).toContain(String(new Date().getFullYear()))
  })
})

describe('SmartArt', () => {
  /** A deck whose slide holds a diagram frame with a drawing behind it. */
  async function withDiagram() {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))

    const drawing =
      '<dsp:drawing xmlns:dsp="dsp" xmlns:a="a"><dsp:spTree><dsp:nvGrpSpPr/><dsp:grpSpPr/>' +
      '<dsp:sp><dsp:nvSpPr><dsp:cNvPr id="9" name="Node"/><dsp:cNvSpPr/></dsp:nvSpPr>' +
      '<dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>' +
      '<a:prstGeom prst="roundRect"/></dsp:spPr>' +
      '<dsp:txBody><a:bodyPr/><a:p><a:r><a:t>Idea</a:t></a:r></a:p></dsp:txBody>' +
      '</dsp:sp></dsp:spTree></dsp:drawing>'

    setPartText(pkg, 'ppt/diagrams/drawing1.xml', drawing)

    const rels = parseRelationships(getPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels') ?? '')
    rels.set('rId9', {
      id: 'rId9',
      type: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
      target: '../diagrams/drawing1.xml',
      external: false,
    })
    setPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels', serializeRelationships(rels))

    const slideText = getPartText(pkg, 'ppt/slides/slide1.xml') ?? ''
    const frame =
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Diagram"/>' +
      '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
      '<p:xfrm><a:off x="1000000" y="500000"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">' +
      '<dgm:relIds xmlns:dgm="dgm" r:dm="rId8"/></a:graphicData></a:graphic></p:graphicFrame>'
    setPartText(
      pkg,
      'ppt/slides/slide1.xml',
      slideText.replace('</p:spTree>', `${frame}</p:spTree>`),
    )

    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')
    return { deck, slide, pkg, themes: readThemes(pkg, deck) }
  }

  it('draws the shapes PowerPoint drew rather than an empty frame', async () => {
    const { deck, slide, pkg, themes } = await withDiagram()
    const { container } = render(
      <SlideView deck={deck} slide={slide} themes={themes} package={pkg} />,
    )

    expect(container.textContent).toContain('Idea')
    expect(container.textContent).not.toContain('SmartArt')
  })

  it('falls back to a labelled box where the deck carries no drawing', async () => {
    // A diagram made somewhere that never opened it in PowerPoint. Nothing
    // here knows what it should look like, and saying so is the honest answer.
    const { deck, slide, pkg, themes } = await withDiagram()
    pkg.parts.delete('ppt/diagrams/drawing1.xml')

    const { container } = render(
      <SlideView deck={deck} slide={slide} themes={themes} package={pkg} />,
    )
    expect(container.textContent).toContain('SmartArt')
  })
})
