import { getPartText } from '@orangery/ooxml-core'
import { CONVENTIONAL_DOCUMENT_PART, readDocxPackage } from '../ooxml/parts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocument } from '../ooxml/parse-document'
import { parseSection } from '../ooxml/section'
import { readSectionHeaders, writeSectionHeaders } from './section-headers'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

async function open(name: string) {
  const pkg = await readDocxPackage(await readFile(join(FIXTURES, `${name}.docx`)))
  const parsed = parseDocument(getPartText(pkg, CONVENTIONAL_DOCUMENT_PART) ?? '')
  return { pkg, section: { ...parseSection(parsed.sectionProperties), preserved: [] as string[] } }
}

const values = (overrides: Partial<Record<string, string>> = {}) => ({
  header: '',
  footer: '',
  firstHeader: '',
  firstFooter: '',
  ...overrides,
})

describe('the headers of one section', () => {
  it('reads nothing from a section that declares none', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    expect(readSectionHeaders(pkg, section)).toEqual(values())
  })

  it('round-trips what it wrote', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    const updated = writeSectionHeaders(pkg, section, values({ header: 'top', footer: 'bottom' }))

    expect(readSectionHeaders(pkg, updated)).toEqual(values({ header: 'top', footer: 'bottom' }))
  })

  it('leaves the first-page pair out of a section that does not set it apart', async () => {
    // Without `w:titlePg` Word ignores those parts, so a file carrying them
    // would hold headers it never shows.
    const { pkg, section } = await open('plain-paragraphs')
    const updated = writeSectionHeaders(pkg, section, values({ firstHeader: 'title' }))

    expect(readSectionHeaders(pkg, updated).firstHeader).toBe('')
  })

  it('writes the first-page pair once the section sets it apart', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    const updated = writeSectionHeaders(
      pkg,
      { ...section, differentFirstPage: true },
      values({ header: 'every page', firstHeader: 'title' }),
    )

    expect(readSectionHeaders(pkg, updated)).toEqual(
      values({ header: 'every page', firstHeader: 'title' }),
    )
  })

  it('keeps two sections apart', async () => {
    // Each section points at parts of its own, so writing one must not reach
    // into the other.
    const { pkg, section } = await open('plain-paragraphs')

    const first = writeSectionHeaders(pkg, section, values({ header: 'chapter' }))
    const second = writeSectionHeaders(
      pkg,
      { ...section, preserved: [] },
      values({ header: 'appendix' }),
    )

    expect(readSectionHeaders(pkg, first).header).toBe('chapter')
    expect(readSectionHeaders(pkg, second).header).toBe('appendix')
  })
})
