import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import {
  ensureExtension,
  openDocumentFrom,
  saveDocumentTo,
  UnsupportedFormatError,
} from './file-operations'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Runs a save and hands back the bytes it tried to write.
 *
 * Disk access goes through a Tauri command, which does not exist here; the mock
 * stands in for it so the conversion itself can be checked.
 */
async function captureWrite(run: () => Promise<unknown>): Promise<Uint8Array> {
  let captured: Uint8Array = new Uint8Array()

  const { invoke } = await import('@tauri-apps/api/core')
  const spy = vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    if (command !== 'write_document') throw new Error(`unexpected command: ${command}`)
    const { path, bytes } = args as { path: string; bytes: number[] }
    captured = new Uint8Array(bytes)
    return Promise.resolve({ path, backup_path: null })
  })

  try {
    await run()
  } finally {
    spy.mockReset()
  }

  return captured
}

describe('ensureExtension', () => {
  it('appends the extension when the user typed a bare name', () => {
    expect(ensureExtension('/a/report', 'docx')).toBe('/a/report.docx')
  })

  it('leaves a path that already has a known extension alone', () => {
    expect(ensureExtension('/a/report.docx', 'docx')).toBe('/a/report.docx')
  })

  it('leaves an unrelated extension alone rather than doubling up', () => {
    expect(ensureExtension('/a/report.txt', 'txt')).toBe('/a/report.txt')
  })
})

describe('openDocumentFrom', () => {
  it('rejects an unrecognised file type before touching the disk', async () => {
    await expect(openDocumentFrom('/a/b.pages')).rejects.toBeInstanceOf(UnsupportedFormatError)
    await expect(openDocumentFrom('/a/b.pages')).rejects.toThrow(/does not recognise/)
  })

  it('rejects a file with no extension at all', async () => {
    await expect(openDocumentFrom('/a/plainfile')).rejects.toBeInstanceOf(UnsupportedFormatError)
  })
})

describe('saveDocumentTo', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph' }] }

  it('rejects a target whose type it does not recognise', async () => {
    await expect(
      saveDocumentTo({ kind: 'flat', format: 'txt' }, doc, '/a/b.pages'),
    ).rejects.toBeInstanceOf(UnsupportedFormatError)
  })

  it('refuses a target it cannot build a package for', async () => {
    await expect(saveDocumentTo({ kind: 'flat', format: 'txt' }, doc, '/a/b.odt')).rejects.toThrow(
      /not supported/,
    )
  })

  it('converts a document that has no package of its own into a real DOCX', async () => {
    const written = await captureWrite(() =>
      saveDocumentTo(
        { kind: 'flat', format: 'md' },
        {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'converted' }] }],
        },
        '/a/b.docx',
      ),
    )

    const zip = await JSZip.loadAsync(written)
    const document = await zip.file('word/document.xml')?.async('string')

    expect(document).toContain('converted')
    // A package Word opens without offering to repair it.
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
    expect(zip.file('word/styles.xml')).not.toBeNull()
  })

  it('carries a picture into the package it builds', async () => {
    const written = await captureWrite(() =>
      saveDocumentTo(
        { kind: 'flat', format: 'md' },
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'image',
                  attrs: { src: PNG, alt: '', width: 72, height: 36 },
                },
              ],
            },
          ],
        },
        '/a/b.docx',
      ),
    )

    const zip = await JSZip.loadAsync(written)
    const relationships = await zip.file('word/_rels/document.xml.rels')?.async('string')
    const document = await zip.file('word/document.xml')?.async('string')

    expect(zip.file('word/media/image1.png')).not.toBeNull()
    expect(relationships).toContain('media/image1.png')

    // The drawing has to name a relationship the package actually has, or Word
    // offers to repair the file.
    const embed = /r:embed="(rId\d+)"/u.exec(document ?? '')
    expect(embed?.[1]).toBeDefined()
    expect(relationships).toContain(`Id="${embed?.[1] ?? ''}"`)
    expect(document).toContain('<wp:extent')
  })

  it('reports a picture it could not carry across instead of dropping it silently', async () => {
    let result: Awaited<ReturnType<typeof saveDocumentTo>> | undefined

    await captureWrite(async () => {
      result = await saveDocumentTo(
        { kind: 'flat', format: 'md' },
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'image', attrs: { src: 'https://example.com/a.png' } }],
            },
          ],
        },
        '/a/b.docx',
      )
    })

    expect(result?.warnings?.[0]?.tag).toBe('image')
  })
})
