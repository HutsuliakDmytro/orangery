import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { duplicateSlide, moveSlides, removeSlides } from './add-slide'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'
import {
  addSection,
  readSections,
  removeSection,
  renameSection,
  sectionOfSlide,
  slidesOfSection,
  syncSections,
} from './sections'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** A deck of eight slides cut into three sections, saved and reopened. */
async function sectioned() {
  const pkg = await load('many-slides')
  addSection(pkg, 'Middle', 3)
  addSection(pkg, 'End', 6)

  return readPptxPackage(await saveDeck(pkg))
}

describe('reading sections', () => {
  it('finds none in a deck that has none', async () => {
    expect(readSections(await load('many-slides'))).toEqual([])
  })

  it('survives being saved and reopened', async () => {
    const sections = readSections(await sectioned())

    expect(sections.map((section) => section.name)).toEqual(['Default Section', 'Middle', 'End'])
    expect(sections.map((section) => section.start)).toEqual([0, 3, 6])
  })

  it('writes the extension PowerPoint looks for', async () => {
    const text = getPartText(await sectioned(), 'ppt/presentation.xml') ?? ''

    expect(text).toContain('{521415D9-36F7-43E2-AB2F-B90AF26B5E84}')
    expect(text).toContain('p14:sectionLst')
  })

  it('keeps the extension list last, as the schema has it', async () => {
    const text = getPartText(await sectioned(), 'ppt/presentation.xml') ?? ''
    expect(text.indexOf('p:extLst')).toBeGreaterThan(text.indexOf('p:sldSz'))
  })
})

describe('where a slide falls', () => {
  it('puts each slide in the section that began at or before it', async () => {
    const sections = readSections(await sectioned())

    expect([0, 2, 3, 5, 6, 7].map((slide) => sectionOfSlide(sections, slide))).toEqual([
      0, 0, 1, 1, 2, 2,
    ])
  })

  it('lists the slides of a section up to the next one', async () => {
    const sections = readSections(await sectioned())

    expect(slidesOfSection(sections, 0, 8)).toEqual([0, 1, 2])
    expect(slidesOfSection(sections, 2, 8)).toEqual([6, 7])
  })
})

describe('adding a section', () => {
  it('splits the deck at the slide it starts on', async () => {
    const pkg = await load('many-slides')
    expect(addSection(pkg, 'Second half', 4)).toBe(true)

    expect(readSections(pkg).map((section) => section.start)).toEqual([0, 4])
  })

  it('names the whole deck when it starts at the first slide of one with none', async () => {
    const pkg = await load('many-slides')
    expect(addSection(pkg, 'Everything', 0)).toBe(true)

    const only = readSections(pkg)
    expect(only.map((section) => [section.name, section.start])).toEqual([['Everything', 0]])
    expect(only[0]?.id).toMatch(/^\{[0-9A-F-]+\}$/u)
  })

  it('refuses a second boundary at the first slide, which is not one', async () => {
    const pkg = await sectioned()
    expect(addSection(pkg, 'Nowhere', 0)).toBe(false)

    const fresh = await load('many-slides')
    expect(addSection(fresh, 'Past the end', 99)).toBe(false)
  })

  it('refuses a boundary where one already is', async () => {
    const pkg = await sectioned()
    expect(addSection(pkg, 'Again', 3)).toBe(false)
  })
})

describe('renaming a section', () => {
  it('changes the name and leaves the boundaries alone', async () => {
    const pkg = await sectioned()
    const middle = readSections(pkg)[1]
    if (middle === undefined) throw new Error('fixture changed')

    expect(renameSection(pkg, middle.id, 'The long part')).toBe(true)
    expect(readSections(pkg).map((section) => section.name)).toEqual([
      'Default Section',
      'The long part',
      'End',
    ])
    expect(readSections(pkg).map((section) => section.start)).toEqual([0, 3, 6])
  })

  it('reports nothing done for a name that is already that', async () => {
    const pkg = await sectioned()
    const middle = readSections(pkg)[1]
    if (middle === undefined) throw new Error('fixture changed')

    expect(renameSection(pkg, middle.id, 'Middle')).toBe(false)
    expect(renameSection(pkg, '{nothing}', 'Middle')).toBe(false)
  })
})

describe('removing a section', () => {
  it('leaves its slides in the one before it', async () => {
    const pkg = await sectioned()
    const middle = readSections(pkg)[1]
    if (middle === undefined) throw new Error('fixture changed')

    expect(removeSection(pkg, middle.id)).toBe(true)
    expect(readSections(pkg).map((section) => section.start)).toEqual([0, 6])
    expect(slidesOfSection(readSections(pkg), 0, 8)).toHaveLength(6)
  })

  it('takes the whole list with it when it is the first', async () => {
    // A boundary at the top is no boundary; without it there are no sections.
    const pkg = await sectioned()
    const first = readSections(pkg)[0]
    if (first === undefined) throw new Error('fixture changed')

    expect(removeSection(pkg, first.id)).toBe(true)
    expect(readSections(pkg)).toEqual([])
    expect(getPartText(pkg, 'ppt/presentation.xml') ?? '').not.toContain('p14:sectionLst')
  })
})

describe('keeping sections in step with the slides', () => {
  it('drops slides that went away', async () => {
    const pkg = await sectioned()
    removeSlides(pkg, [0, 1])
    syncSections(pkg)

    const sections = readSections(await readPptxPackage(await saveDeck(pkg)))
    expect(sections.map((section) => section.start)).toEqual([0, 1, 4])
  })

  it('empties a section whose slides all went away', async () => {
    const pkg = await sectioned()
    removeSlides(pkg, [3, 4, 5])
    syncSections(pkg)

    const sections = readSections(await readPptxPackage(await saveDeck(pkg)))
    expect(sections.map((section) => section.name)).toEqual(['Default Section', 'Middle', 'End'])
    expect(slidesOfSection(sections, 1, 5)).toEqual([])
  })

  it('puts a new slide in the section it landed in', async () => {
    const pkg = await sectioned()
    duplicateSlide(pkg, 4)
    syncSections(pkg)

    const sections = readSections(await readPptxPackage(await saveDeck(pkg)))
    expect(slidesOfSection(sections, 1, 9)).toEqual([3, 4, 5, 6])
    expect(sections[2]?.start).toBe(7)
  })

  it('moves a slide into the section it was dragged to', async () => {
    const pkg = await sectioned()
    moveSlides(pkg, [0], 7)
    syncSections(pkg)

    const sections = readSections(await readPptxPackage(await saveDeck(pkg)))
    expect(sectionOfSlide(sections, 7)).toBe(2)
    expect(sections.map((section) => section.start)).toEqual([0, 2, 5])
  })
})
