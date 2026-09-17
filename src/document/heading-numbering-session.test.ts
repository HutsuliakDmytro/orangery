import { describe, expect, it } from 'vitest'
import { createNewDocx, openDocx, saveDocx } from './docx-file'
import { getPartText, NUMBERING_PART, STYLES_PART } from '../ooxml/package'
import { readHeadingNumbering } from './heading-numbering-session'

const headings = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Under' }] },
  ],
}

describe('numbered headings in the package', () => {
  it('leaves a new document unnumbered', async () => {
    expect((await createNewDocx()).headingNumbering).toBeNull()
  })

  it('writes a definition and points the heading styles at it', async () => {
    const document = await createNewDocx()
    await saveDocx(document, headings, { headingNumbering: 'decimal' })

    const numbering = getPartText(document.pkg, NUMBERING_PART) ?? ''
    const styles = getPartText(document.pkg, STYLES_PART) ?? ''

    // The definition names the style at each level; that is what makes Word
    // read it as numbering linked to the headings.
    expect(numbering).toContain('<w:pStyle w:val="Heading1"/>')
    expect(numbering).toContain('w:val="%1.%2."')
    expect(styles).toContain('<w:numPr>')
  })

  it('declares the numbering part it created, so Word does not repair the file', async () => {
    const document = await createNewDocx()
    await saveDocx(document, headings, { headingNumbering: 'decimal' })

    expect(getPartText(document.pkg, '[Content_Types].xml')).toContain('/word/numbering.xml')
    expect(getPartText(document.pkg, 'word/_rels/document.xml.rels')).toContain('numbering.xml')
  })

  it('round-trips the scheme through a save and an open', async () => {
    const document = await createNewDocx()
    const saved = await saveDocx(document, headings, { headingNumbering: 'outline' })

    expect((await openDocx(saved)).headingNumbering).toBe('outline')
  })

  it('tells the two schemes apart by what the levels carry', async () => {
    const document = await createNewDocx()
    const saved = await saveDocx(document, headings, { headingNumbering: 'decimal' })

    expect((await openDocx(saved)).headingNumbering).toBe('decimal')
  })

  it('reuses its definition rather than adding one on every save', async () => {
    const document = await createNewDocx()
    await saveDocx(document, headings, { headingNumbering: 'decimal' })
    await saveDocx(document, headings, { headingNumbering: 'outline' })

    const numbering = getPartText(document.pkg, NUMBERING_PART) ?? ''
    expect(numbering.match(/<w:abstractNum /gu)).toHaveLength(1)
    expect(numbering.match(/<w:num /gu)).toHaveLength(1)
  })

  it('takes the numbering off the styles when it is turned off', async () => {
    const document = await createNewDocx()
    const numbered = await saveDocx(document, headings, { headingNumbering: 'decimal' })
    expect((await openDocx(numbered)).headingNumbering).toBe('decimal')

    const plain = await saveDocx(await openDocx(numbered), headings, { headingNumbering: null })
    expect((await openDocx(plain)).headingNumbering).toBeNull()
  })

  it('leaves the file alone when the caller says nothing', async () => {
    const document = await createNewDocx()
    const numbered = await openDocx(
      await saveDocx(document, headings, { headingNumbering: 'decimal' }),
    )

    const again = await saveDocx(numbered, headings)
    expect((await openDocx(again)).headingNumbering).toBe('decimal')
  })

  it('reads nothing from a style pointing at a definition the file does not have', async () => {
    // Word shows such a heading unnumbered, so it is read the same way.
    const document = await createNewDocx()
    await saveDocx(document, headings, { headingNumbering: 'decimal' })
    document.pkg.parts.delete(NUMBERING_PART)

    expect(readHeadingNumbering(document.pkg)).toBeNull()
  })
})
