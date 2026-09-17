import { describe, expect, it } from 'vitest'
import { createNewDocx, openDocx, saveDocx } from './docx-file'
import { COMMENTS_PART } from '../ooxml/comments'
import { getPartText } from '../ooxml/package'
import { anchoredComments, writeComments } from './comments-session'
import { initialsOf } from '../store/comments-store'
import type { ProseMirrorNodeJson } from '../ooxml/prosemirror-json'

const commented = (id: number): ProseMirrorNodeJson => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'about this', marks: [{ type: 'comment', attrs: { commentId: id } }] }],
    },
  ],
})

const comment = (id: number, text = 'Needs a source.') => ({
  id,
  author: 'Ada Lovelace',
  initials: 'AL',
  date: '2026-09-17T10:00:00Z',
  text,
})

describe('anchoredComments', () => {
  it('finds the ids the body points at', () => {
    expect([...anchoredComments(commented(3))]).toEqual([3])
  })

  it('finds none in a document with no comments', () => {
    expect(anchoredComments({ type: 'doc', content: [{ type: 'paragraph' }] }).size).toBe(0)
  })
})

describe('writing the comments part', () => {
  it('adds the part, its relationship and its content type', async () => {
    const document = await createNewDocx()
    writeComments(document.pkg, new Map([[0, comment(0)]]), commented(0))

    expect(getPartText(document.pkg, COMMENTS_PART)).toContain('Needs a source.')
    expect(getPartText(document.pkg, '[Content_Types].xml')).toContain('/word/comments.xml')
    expect(getPartText(document.pkg, 'word/_rels/document.xml.rels')).toContain('comments.xml')
  })

  it('adds nothing to a document that has none and gains none', async () => {
    const document = await createNewDocx()
    writeComments(document.pkg, new Map(), document.doc)

    expect(document.pkg.parts.has(COMMENTS_PART)).toBe(false)
  })

  it('drops a comment the body no longer points at', async () => {
    // Its text would otherwise stay in the file for ever, attached to nothing.
    const document = await createNewDocx()
    writeComments(document.pkg, new Map([[0, comment(0)], [1, comment(1, 'orphan')]]), commented(0))

    expect(getPartText(document.pkg, COMMENTS_PART)).not.toContain('orphan')
  })

  it('round-trips through a save and an open', async () => {
    const document = await createNewDocx()
    const saved = await saveDocx(document, commented(0), { comments: new Map([[0, comment(0)]]) })
    const reopened = await openDocx(saved)

    expect(reopened.comments.get(0)?.author).toBe('Ada Lovelace')
    expect(reopened.comments.get(0)?.text).toBe('Needs a source.')
    expect(reopened.doc.content?.[0]?.content?.[0]?.marks?.some((m) => m.type === 'comment')).toBe(
      true,
    )
  })

  it('keeps the comments the file was opened with when the caller says nothing', async () => {
    const document = await createNewDocx()
    const saved = await openDocx(
      await saveDocx(document, commented(0), { comments: new Map([[0, comment(0)]]) }),
    )

    const again = await openDocx(await saveDocx(saved, saved.doc))
    expect(again.comments.get(0)?.text).toBe('Needs a source.')
  })
})

describe('initialsOf', () => {
  it('takes the first letter of each of the first two names', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL')
    expect(initialsOf('Ada')).toBe('A')
  })

  it('has nothing to take from an empty name', () => {
    expect(initialsOf('   ')).toBe('')
  })
})
