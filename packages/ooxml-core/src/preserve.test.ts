import { describe, expect, it } from 'vitest'
import { element } from './xml'
import { declarationOf, preservingRoot, rootAttributesOf, setPartXml } from './preserve'
import { getPartText, setPartText } from './package'
import type { OoxmlPackage } from './package'

/**
 * A part rewritten keeps what the file said about it.
 *
 * The rule these are about: a model holds what somebody thought to model, and
 * everything else a part carried — its declaration, the namespaces its root
 * declared — has to come back from the part rather than from the model.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/5
 * https://github.com/HutsuliakDmytro/orangery/issues/16
 */

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

describe('declarationOf', () => {
  it('gives back the declaration exactly as written', () => {
    expect(declarationOf("<?xml version='1.0' encoding='utf-8'?>\n<a/>")).toBe(
      "<?xml version='1.0' encoding='utf-8'?>\n",
    )
    expect(declarationOf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<a/>')).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n',
    )
  })

  it('gives nothing for a part that has none', () => {
    expect(declarationOf('<a/>')).toBe('')
    expect(declarationOf(undefined)).toBe('')
  })
})

describe('rootAttributesOf', () => {
  it('reads the root element regardless of the declaration', () => {
    const attributes = rootAttributesOf(
      `<?xml version="1.0"?><w:footnotes xmlns:w="${WORD}" xmlns:v="urn:schemas-microsoft-com:vml"><w:footnote/></w:footnotes>`,
    )

    expect(attributes).toEqual({ 'xmlns:w': WORD, 'xmlns:v': 'urn:schemas-microsoft-com:vml' })
  })

  it('reads a self-closed root, and skips a comment before it', () => {
    expect(rootAttributesOf('<!-- made by something --><w:styles xmlns:w="x"/>')).toEqual({
      'xmlns:w': 'x',
    })
  })

  it('gives nothing for a part with no element in it', () => {
    expect(rootAttributesOf('')).toEqual({})
    expect(rootAttributesOf(undefined)).toEqual({})
  })
})

describe('preservingRoot', () => {
  const previous = `<?xml version='1.0' encoding='utf-8'?>\n<w:footnotes xmlns:w="${WORD}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:footnote w:id="1"/></w:footnotes>`

  it('keeps the declaration the part was written with', () => {
    const written = preservingRoot(previous, [element('w:footnotes', { 'xmlns:w': WORD })])

    expect(written.startsWith("<?xml version='1.0' encoding='utf-8'?>\n")).toBe(true)
  })

  it('keeps the namespaces the writer knew nothing about', () => {
    const written = preservingRoot(previous, [element('w:footnotes', { 'xmlns:w': WORD })])

    expect(written).toContain('xmlns:v="urn:schemas-microsoft-com:vml"')
    expect(written).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"')
  })

  it('lets the writer win where it said something', () => {
    const written = preservingRoot(`<w:styles xmlns:w="old" xmlns:x="kept"/>`, [
      element('w:styles', { 'xmlns:w': 'new' }),
    ])

    expect(written).toContain('xmlns:w="new"')
    expect(written).toContain('xmlns:x="kept"')
  })

  it('writes our own declaration for a part that did not exist', () => {
    expect(preservingRoot(undefined, [element('w:comments', { 'xmlns:w': WORD })])).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:comments xmlns:w="${WORD}"/>`,
    )
  })

  it('keeps nothing from a part that was a different element', () => {
    const written = preservingRoot('<w:hdr xmlns:z="gone"/>', [
      element('w:ftr', { 'xmlns:w': WORD }),
    ])

    expect(written).not.toContain('gone')
  })
})

describe('setPartXml', () => {
  it('takes the old text out of the package itself', () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'word/comments.xml', `<?xml version='1.0'?>\n<w:comments xmlns:v="vml"/>`)

    setPartXml(pkg, 'word/comments.xml', [element('w:comments', { 'xmlns:w': WORD })])

    const written = getPartText(pkg, 'word/comments.xml') ?? ''
    expect(written.startsWith("<?xml version='1.0'?>\n")).toBe(true)
    expect(written).toContain('xmlns:v="vml"')
    expect(written).toContain(`xmlns:w="${WORD}"`)
  })
})
