import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPptxPackage } from './parts'
import { readPresentation, referencedParts } from './presentation'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function open(name: string) {
  return readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
}

const mapOf = async (name: string) => readPresentation(await open(name))

describe('readPptxPackage', () => {
  it('reads a deck', async () => {
    const pkg = await open('empty')
    expect(pkg.parts.has('ppt/presentation.xml')).toBe(true)
  })

  it('refuses a zip that is not a deck', async () => {
    const docx = join(process.cwd(), '../../apps/docs/tests/fixtures/docx/synthetic/headings.docx')
    await expect(readPptxPackage(await readFile(docx))).rejects.toThrow('ppt/presentation.xml')
  })
})

describe('the slide list', () => {
  it('follows sldIdLst, not the order of the rels file', async () => {
    const map = await mapOf('many-slides')

    expect(map.slides).toHaveLength(8)
    expect(map.slides.map((slide) => slide.path)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/slide4.xml',
      'ppt/slides/slide5.xml',
      'ppt/slides/slide6.xml',
      'ppt/slides/slide7.xml',
      'ppt/slides/slide8.xml',
    ])
  })

  it('gives every slide the layout it is built on', async () => {
    const map = await mapOf('placeholders')

    // The target is written `../slideLayouts/slideLayout2.xml` from inside
    // ppt/slides, so this also proves the resolver walks out of the directory.
    expect(map.slides[0]?.layout).toMatch(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/u)
  })

  it('finds the notes page when there is one', async () => {
    const withNotes = await mapOf('notes')
    const without = await mapOf('empty')

    expect(withNotes.slides[0]?.notes).toBe('ppt/notesSlides/notesSlide1.xml')
    expect(without.slides[0]?.notes).toBeNull()
  })
})

describe('masters', () => {
  it('lists every layout a master offers, used or not', async () => {
    const map = await mapOf('empty')
    const [master] = map.masters

    expect(map.masters).toHaveLength(1)
    // The template carries eleven; a deck using one of them may drop none.
    expect(master?.layouts.length).toBeGreaterThanOrEqual(11)
    expect(master?.layouts.every((path) => path.startsWith('ppt/slideLayouts/'))).toBe(true)
  })

  it('finds the theme the master is drawn with', async () => {
    const map = await mapOf('empty')
    expect(map.masters[0]?.theme).toBe('ppt/theme/theme1.xml')
  })

  it('finds the notes master, which is a part of the presentation', async () => {
    expect((await mapOf('notes')).notesMaster).toBe('ppt/notesMasters/notesMaster1.xml')
  })
})

describe('slide size', () => {
  it('reads the dimensions', async () => {
    const map = await mapOf('empty')
    expect(map.slideSize).toEqual({ width: 9144000, height: 6858000 })
  })

  it('believes the dimensions over the type attribute', async () => {
    // This deck is 16:9 by cx/cy while `type` still says screen4x3, which is
    // what a generator leaves behind. Reading the label would report 4:3.
    const map = await mapOf('sixteen-by-nine')
    expect(map.slideSize).toEqual({ width: 12192000, height: 6858000 })
  })

  it('reads the notes size too, which is portrait', async () => {
    const map = await mapOf('notes')
    expect(map.notesSize.height).toBeGreaterThan(map.notesSize.width)
  })
})

describe('referencedParts', () => {
  it('names only parts that are actually in the package', async () => {
    const pkg = await open('picture')
    const map = readPresentation(pkg)

    for (const path of referencedParts(map)) {
      expect(pkg.parts.has(path), path).toBe(true)
    }
  })

  it('reaches the whole graph from one slide', async () => {
    const map = await mapOf('notes')
    const parts = referencedParts(map)

    expect(parts).toContain('ppt/slides/slide1.xml')
    expect(parts).toContain('ppt/notesSlides/notesSlide1.xml')
    expect(parts).toContain('ppt/slideMasters/slideMaster1.xml')
    expect(parts).toContain('ppt/theme/theme1.xml')
  })
})
