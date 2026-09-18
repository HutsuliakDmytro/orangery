import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import { addGuide, moveGuide, readGuides, removeGuide, writeGuides } from './guides'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'

/** The guides a person drags out of the rulers. */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** An eighth of a point, which is what the file counts in. */
const UNIT = 12700 / 8

const reopen = async (pkg: Awaited<ReturnType<typeof load>>) => readPptxPackage(await saveDeck(pkg))

describe('reading guides', () => {
  it('reads what the deck was left with, in EMU', async () => {
    const guides = readGuides(await load('shapes'))

    // The fixture carries PowerPoint's own two, on the middle of a 4:3 slide.
    expect(guides).toEqual([
      { orientation: 'horz', at: 2160 * UNIT },
      { orientation: 'vert', at: 2880 * UNIT },
    ])
  })

  it('treats a guide with no orientation as vertical, which is the default', async () => {
    const pkg = await load('shapes')
    expect(readGuides(pkg).some((guide) => guide.orientation === 'vert')).toBe(true)
  })

  it('finds none in a deck whose view properties say nothing', async () => {
    const pkg = await load('shapes')
    const text = getPartText(pkg, 'ppt/viewProps.xml') ?? ''
    setPartText(pkg, 'ppt/viewProps.xml', text.replace(/<p:guideLst>.*?<\/p:guideLst>/su, ''))

    expect(readGuides(pkg)).toEqual([])
  })
})

describe('writing guides', () => {
  it('survives being saved and reopened', async () => {
    const pkg = await load('shapes')
    writeGuides(pkg, [{ orientation: 'vert', at: 1_000_000 }])

    const guides = readGuides(await reopen(pkg))
    expect(guides).toHaveLength(1)
    expect(guides[0]?.at).toBeCloseTo(1_000_000, -3)
  })

  it('leaves the orientation off a vertical one, as the format does', async () => {
    const pkg = await load('shapes')
    writeGuides(pkg, [{ orientation: 'vert', at: 1_000_000 }])

    expect(getPartText(pkg, 'ppt/viewProps.xml') ?? '').not.toContain('orient=')
  })

  it('removes the element rather than writing an empty one', async () => {
    // A deck that never had guides should not grow a list because somebody
    // opened the rulers.
    const pkg = await load('shapes')
    expect(writeGuides(pkg, [])).toBe(true)

    expect(getPartText(pkg, 'ppt/viewProps.xml') ?? '').not.toContain('guideLst')
    expect(readGuides(pkg)).toEqual([])
  })

  it('builds the chain when the view properties have none of it', async () => {
    const pkg = await load('shapes')
    setPartText(
      pkg,
      'ppt/viewProps.xml',
      '<?xml version="1.0"?><p:viewPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    )

    expect(addGuide(pkg, { orientation: 'horz', at: 2_000_000 })).toBe(true)

    const text = getPartText(pkg, 'ppt/viewProps.xml') ?? ''
    // Without a scale and an origin PowerPoint offers to repair the file.
    expect(text).toContain('p:cViewPr')
    expect(text).toContain('a:sx')
    expect(text).toContain('p:origin')
    const [guide] = readGuides(pkg)
    expect(guide?.orientation).toBe('horz')
    expect(guide?.at).toBeCloseTo(2_000_000, -3)
  })

  it('reports nothing done for a deck with no view properties at all', async () => {
    const pkg = await load('shapes')
    pkg.parts.delete('ppt/viewProps.xml')

    expect(writeGuides(pkg, [{ orientation: 'vert', at: 0 }])).toBe(false)
    expect(readGuides(pkg)).toEqual([])
  })
})

describe('changing one guide', () => {
  it('adds one and keeps the others', async () => {
    const pkg = await load('shapes')
    expect(addGuide(pkg, { orientation: 'vert', at: 1_000_000 })).toBe(true)

    expect(readGuides(pkg)).toHaveLength(3)
  })

  it('moves the one it names', async () => {
    const pkg = await load('shapes')
    expect(moveGuide(pkg, 0, 500_000)).toBe(true)

    const guides = readGuides(pkg)
    expect(guides[0]?.at).toBeCloseTo(500_000, -3)
    expect(guides[1]?.at).toBeCloseTo(2880 * UNIT, -3)
  })

  it('reports nothing done for a guide that is already there', async () => {
    const pkg = await load('shapes')
    expect(moveGuide(pkg, 0, 2160 * UNIT)).toBe(false)
    expect(moveGuide(pkg, 9, 0)).toBe(false)
  })

  it('removes the one it names', async () => {
    const pkg = await load('shapes')
    expect(removeGuide(pkg, 0)).toBe(true)

    expect(readGuides(pkg)).toEqual([{ orientation: 'vert', at: 2880 * UNIT }])
    expect(removeGuide(pkg, 5)).toBe(false)
  })

  it('leaves the slides untouched, because a guide is not on them', async () => {
    const original = await load('shapes')
    const pkg = await load('shapes')
    addGuide(pkg, { orientation: 'vert', at: 1_000_000 })

    expect(getPartText(pkg, 'ppt/slides/slide1.xml')).toBe(
      getPartText(original, 'ppt/slides/slide1.xml'),
    )
  })
  it('rounds to the eighth of a point the format counts in', async () => {
    // The unit is coarser than EMU, so a guide comes back within a few hundred
    // of where it was put — which is a fortieth of a millimetre.
    const pkg = await load('shapes')
    writeGuides(pkg, [{ orientation: 'vert', at: 1_234_567 }])

    const [guide] = readGuides(pkg)
    expect(guide?.at).not.toBe(1_234_567)
    expect(Math.abs((guide?.at ?? 0) - 1_234_567)).toBeLessThan(UNIT)
  })
})
