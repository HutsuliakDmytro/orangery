import { getPartText } from '@orangery/ooxml-core'
import { SETTINGS_PART } from '../ooxml/parts'
import { describe, expect, it } from 'vitest'
import { createNewDocx, openDocx, saveDocx } from './docx-file'
import { readTrackChanges, writeTrackChanges } from './track-changes-session'

const doc = { type: 'doc', content: [{ type: 'paragraph' }] }

/** The template carries no settings part, so the tests put one there. */
async function withSettings(body = '') {
  const document = await createNewDocx()
  document.pkg.parts.set(SETTINGS_PART, {
    path: SETTINGS_PART,
    bytes: new Uint8Array(),
    date: new Date(),
    text: `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:settings>`,
  })
  return document
}

describe('the recording flag', () => {
  it('reads a document that records changes', async () => {
    const document = await withSettings('<w:trackChanges/>')
    expect(readTrackChanges(document.pkg)).toBe(true)
  })

  it('reads one that does not', async () => {
    expect(readTrackChanges((await withSettings()).pkg)).toBe(false)
  })

  it('reads an explicit no as no', async () => {
    const document = await withSettings('<w:trackChanges w:val="0"/>')
    expect(readTrackChanges(document.pkg)).toBe(false)
  })

  it('reads nothing from a document with no settings at all', async () => {
    expect(readTrackChanges((await createNewDocx()).pkg)).toBe(false)
  })

  it('writes the flag and reads it back', async () => {
    const document = await withSettings()
    writeTrackChanges(document.pkg, true)

    expect(readTrackChanges(document.pkg)).toBe(true)
  })

  it('takes the flag out rather than writing a nay-saying one', async () => {
    // Its absence is what "not recording" means, and that is what Word writes.
    const document = await withSettings('<w:trackChanges/>')
    writeTrackChanges(document.pkg, false)

    expect(getPartText(document.pkg, SETTINGS_PART)).not.toContain('trackChanges')
  })

  it('leaves the rest of the settings where they were', async () => {
    const document = await withSettings('<w:zoom w:percent="100"/>')
    writeTrackChanges(document.pkg, true)

    expect(getPartText(document.pkg, SETTINGS_PART)).toContain('w:zoom')
  })

  it('survives a save and an open', async () => {
    const document = await withSettings()
    const reopened = await openDocx(await saveDocx(document, doc, { trackChanges: true }))

    expect(reopened.trackChanges).toBe(true)
  })

  it('leaves the file as it was when the caller says nothing', async () => {
    const document = await withSettings('<w:trackChanges/>')
    const reopened = await openDocx(await saveDocx(document, doc))

    expect(reopened.trackChanges).toBe(true)
  })
})
