import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What the operating system is told this app opens.
 *
 * `bundle.fileAssociations` becomes `CFBundleDocumentTypes` on macOS, the
 * registry on Windows and `MimeType=` in the `.desktop` file on Linux, and a
 * mistake in it is invisible until somebody double-clicks a file and the wrong
 * app comes up — or this one comes up for a file it cannot read. Each app
 * claims its own formats and none of the others'.
 */

interface Association {
  ext: string[]
  role?: string
  mimeType?: string
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'),
) as { bundle: { fileAssociations: Association[] } }

const associations = config.bundle.fileAssociations
const extensions = associations.flatMap((one) => one.ext)

describe('the files Orangery Sheets says it opens', () => {
  it('are its own formats, every one of them', () => {
    expect([...extensions].sort()).toEqual(['xlsx', 'xlsm', 'ods'].sort())
  })

  it("are none of the other apps' formats", () => {
    for (const theirs of ['docx', 'odt', 'rtf', 'pptx', 'odp'])
      expect(extensions).not.toContain(theirs)
  })

  it('are opened as an editor, not a viewer', () => {
    for (const one of associations) expect(one.role).toBe('Editor')
  })

  it('each say their own MIME type, so Linux offers the app for the right files', () => {
    const types = associations.map((one) => one.mimeType)
    for (const type of types) expect(type).toMatch(/^[a-z]+\/[\w.+-]+$/u)
    expect(new Set(types).size).toBe(types.length)
  })
})
