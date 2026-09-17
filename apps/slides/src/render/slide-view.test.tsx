import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readDeck, readPptxPackage, readThemes } from '@orangery/ooxml-presentation'
import { SlideView } from './slide-view'

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function open(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (!slide) throw new Error('fixture has no slides')

  return { deck, slide, themes: readThemes(pkg, deck) }
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
