import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { addPicture, createNewOdt, manifestFor, nextPictureName, newOdtTemplate } from './odt-file'
import { MANIFEST_PART, MIMETYPE_PART, ODT_MIME_TYPE, saveOdt } from './converters/odt'
import { textContentOf } from './converters/types'

describe('newOdtTemplate', () => {
  it('declares every part it ships in the manifest', () => {
    const template = newOdtTemplate().text
    const manifest = template[MANIFEST_PART] ?? ''

    for (const path of Object.keys(template)) {
      if (path === MANIFEST_PART) continue
      expect(manifest).toContain(`manifest:full-path="${path}"`)
    }
    // The root entry is what identifies the package as a text document.
    expect(manifest).toContain(`manifest:media-type="${ODT_MIME_TYPE}"`)
  })

  it('declares every namespace the body can use', () => {
    const content = newOdtTemplate().text['content.xml'] ?? ''

    for (const prefix of ['text', 'table', 'draw', 'svg', 'xlink', 'style', 'fo']) {
      expect(content).toContain(`xmlns:${prefix}=`)
    }
  })
})

describe('createNewOdt', () => {
  it('opens as a document with an empty paragraph', async () => {
    const document = await createNewOdt()

    expect(document.doc.content?.[0]?.type).toBe('paragraph')
    expect(document.warnings).toHaveLength(0)
  })

  it('keeps the mimetype stored uncompressed and first', async () => {
    const saved = await saveOdt(await createNewOdt(), {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    })

    const zip = await JSZip.loadAsync(saved)
    expect(Object.keys(zip.files)[0]).toBe(MIMETYPE_PART)
    expect(await zip.file(MIMETYPE_PART)?.async('string')).toBe(ODT_MIME_TYPE)
  })

  it('round-trips the text it was given', async () => {
    const fresh = await createNewOdt()
    const saved = await saveOdt(fresh, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    })

    const { openOdt } = await import('./converters/odt')
    const reopened = await openOdt(saved)

    expect(reopened.doc.content?.[0]?.type).toBe('heading')
    expect(textContentOf(reopened.doc)).toContain('Body')
  })
})

describe('pictures', () => {
  const bytes = new Uint8Array([137, 80, 78, 71])

  it('numbers a picture past the ones already there', async () => {
    const pkg = (await createNewOdt()).pkg
    pkg.parts.set('Pictures/image4.png', { bytes })

    expect(nextPictureName(pkg, 'png')).toBe('image5.png')
  })

  it('adds the picture and declares it in the manifest', async () => {
    const pkg = (await createNewOdt()).pkg
    const href = addPicture(pkg, 'png', bytes)

    expect(href).toBe('Pictures/image1.png')
    expect(pkg.parts.has(href)).toBe(true)

    const manifest = pkg.parts.get(MANIFEST_PART)?.text ?? ''
    expect(manifest).toContain('manifest:full-path="Pictures/image1.png"')
    expect(manifest).toContain('manifest:media-type="image/png"')
  })
})

describe('manifestFor', () => {
  it('gives an XML part its own media type rather than guessing from the name', () => {
    expect(manifestFor(['content.xml'])).toContain(
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
    )
  })
})
