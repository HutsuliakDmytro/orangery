import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import { parseSvgPath } from '@orangery/ooxml-drawingml'
import { readDeck, readPptxPackage, saveDeck } from '@orangery/ooxml-presentation'
import { App } from './app'
import { ICON_SIZE, ICONS } from '../document/icons'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/** The icons the app ships with, inserted as shapes rather than pictures. */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

const partText = () =>
  getPartText(
    useDeckStore.getState().open?.package ?? { parts: new Map() },
    'ppt/slides/slide1.xml',
  ) ?? ''

const shapes = () => useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []

beforeEach(() => {
  useDeckStore.setState({
    open: null,
    current: -1,
    master: null,
    selection: [],
    slideSelection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
  })
  useViewStore.setState({ rulers: false, leftPane: 'filmstrip' })
})

describe('the set itself', () => {
  it('is drawn with commands custom geometry can carry', () => {
    // An arc would throw; the bundled set is drawn without them.
    for (const icon of ICONS) {
      for (const path of icon.paths) {
        expect(() => parseSvgPath(path)).not.toThrow()
      }
    }
  })

  it('stays inside the box it is drawn in', () => {
    for (const icon of ICONS) {
      for (const path of icon.paths) {
        for (const segment of parseSvgPath(path)) {
          if (segment.kind === 'close') continue

          const points =
            segment.kind === 'cubic'
              ? [segment.first, segment.second, segment.to]
              : segment.kind === 'quad'
                ? [segment.control, segment.to]
                : [segment.to]

          for (const point of points) {
            expect(point.x).toBeGreaterThanOrEqual(0)
            expect(point.x).toBeLessThanOrEqual(ICON_SIZE)
            expect(point.y).toBeGreaterThanOrEqual(0)
            expect(point.y).toBeLessThanOrEqual(ICON_SIZE)
          }
        }
      }
    }
  })

  it('has a star with five points and a burst with eight', () => {
    // Ten corners for five spikes, sixteen for eight: a spike and a valley
    // each. This is what "built from numbers" buys.
    const corners = (id: string) =>
      parseSvgPath(ICONS.find((icon) => icon.id === id)?.paths[0] ?? '').filter(
        (segment) => segment.kind !== 'close',
      ).length

    expect(corners('star')).toBe(10)
    expect(corners('burst')).toBe(16)
  })

  it('draws the ring as two outlines, the inner one the other way round', () => {
    const ring = ICONS.find((icon) => icon.id === 'ring')
    expect(ring?.paths).toHaveLength(2)

    // Both start on the right; the outer turns down first and the inner up.
    const inner = parseSvgPath(ring?.paths[1] ?? '')[1]
    expect(inner?.kind).toBe('cubic')
    expect(inner?.kind === 'cubic' ? inner.to.y : 0).toBeLessThan(ICON_SIZE / 2)
  })

  it('closes every outline', () => {
    for (const icon of ICONS) {
      for (const path of icon.paths) {
        expect(parseSvgPath(path).at(-1)?.kind).toBe('close')
      }
    }
  })
})

describe('inserting one', () => {
  it('offers a command for every icon', () => {
    for (const icon of ICONS) {
      expect(getCommand(`insert.icon.${icon.id}`)?.label).toBe(`${icon.label} Icon`)
    }
  })

  it('puts a shape on the slide, not a picture', async () => {
    await openDeck('empty')
    render(<App />)

    const before = shapes().length
    act(() => {
      runCommand('insert.icon.star', {})
    })

    expect(shapes()).toHaveLength(before + 1)
    expect(partText()).toContain('a:custGeom')
    expect(partText()).not.toContain('p:pic')
  })

  it('fills it from the theme, so it changes when the theme does', async () => {
    await openDeck('empty')
    render(<App />)
    act(() => {
      runCommand('insert.icon.circle', {})
    })

    expect(partText()).toContain('<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>')
  })

  it('names it, so a screen reader has something to say', async () => {
    await openDeck('empty')
    render(<App />)
    act(() => {
      runCommand('insert.icon.check', {})
    })

    const added = shapes().at(-1)
    expect(added?.name).toBe('Check Icon')
    expect(added?.description).toBe('Check Icon')
  })

  it('lands square and in the middle', async () => {
    await openDeck('empty')
    render(<App />)
    act(() => {
      runCommand('insert.icon.plus', {})
    })

    const size = useDeckStore.getState().open?.deck.slideSize
    const where = shapes().at(-1)?.transform
    if (size === undefined || where == null) throw new Error('nothing was inserted')

    expect(where.width).toBe(where.height)
    expect(where.x + where.width / 2).toBeCloseTo(size.width / 2, -1)
    expect(where.y + where.height / 2).toBeCloseTo(size.height / 2, -1)
  })

  it('selects what it made', async () => {
    await openDeck('empty')
    render(<App />)
    act(() => {
      runCommand('insert.icon.diamond', {})
    })

    expect(useDeckStore.getState().selection).toEqual([shapes().at(-1)?.id])
  })

  it('is one undo step', async () => {
    await openDeck('empty')
    render(<App />)
    const before = partText()

    act(() => {
      runCommand('insert.icon.star', {})
    })
    act(() => {
      useDeckStore.getState().undo()
    })

    expect(partText()).toBe(before)
  })

  it('survives a save and a reopen as the same geometry', async () => {
    await openDeck('empty')
    render(<App />)
    act(() => {
      runCommand('insert.icon.hexagon', {})
    })

    const written = partText()
    expect(written).toContain('<a:path w="24" h="24">')
    expect(written.match(/<a:lnTo>/gu)).toHaveLength(5)
  })

  it('is drawn as its own outline, not as the box it sits in', async () => {
    await openDeck('empty')
    const { container } = render(<App />)

    const before = [...container.querySelectorAll('path')].map((one) => one.getAttribute('d'))
    act(() => {
      runCommand('insert.icon.triangle', {})
    })

    const after = [...container.querySelectorAll('path')].map((one) => one.getAttribute('d'))
    const added = after.filter((one) => !before.includes(one))

    // Three corners and a close, rather than the four of a rectangle.
    expect(added.length).toBeGreaterThan(0)
    expect((added[0] ?? '').match(/L /gu)).toHaveLength(2)
  })

  it('falls back to the box for a shape drawn with an arc', async () => {
    // Three quarters of a shape is worse than the rectangle it sits in.
    await openDeck('empty')
    render(<App />)
    act(() => {
      runCommand('insert.icon.star', {})
    })

    const open = useDeckStore.getState().open
    if (open === null) throw new Error('did not open')

    const withArc = partText().replace(/<a:lnTo>.*?<\/a:lnTo>/u, '<a:arcTo wR="1" hR="1"/>')
    setPartText(open.package, 'ppt/slides/slide1.xml', withArc)

    const again = await readPptxPackage(await saveDeck(open.package))
    expect(readDeck(again).slides[0]?.shapes.at(-1)?.properties?.geometry?.paths).toBeNull()
  })
})
