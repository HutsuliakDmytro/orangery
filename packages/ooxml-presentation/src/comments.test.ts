import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addRelationship,
  getPartText,
  parseRelationships,
  serializeRelationships,
  setPartText,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { addComment, readComments, removeComment, replyToComment, resolveComment } from './comments'
import { readDeck } from './deck'
import type { Slide } from './deck'
import { COMMENTS_RELATIONSHIP, MODERN_COMMENTS_RELATIONSHIP, readPptxPackage } from './parts'
import { saveDeck } from './save'

/**
 * What people have said about a slide.
 *
 * No fixture carries comments, so they are put in here — which is also the
 * clearest way to say what each format looks like.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'

const OLD_COMMENTS =
  `<p:cmLst xmlns:p="${P_NS}">` +
  '<p:cm authorId="0" dt="2020-05-01T09:00:00" idx="1"><p:pos x="0" y="0"/>' +
  '<p:text>Tighten this up</p:text></p:cm></p:cmLst>'

const MODERN_COMMENTS =
  '<p188:cmLst xmlns:p188="p188" xmlns:a="a">' +
  '<p188:cm id="{C1}" authorId="{A1}" created="2023-02-02T10:00:00Z" status="resolved">' +
  '<p188:txBody><a:bodyPr/><a:p><a:r><a:t>Fixed in the new version</a:t></a:r></a:p>' +
  '</p188:txBody></p188:cm></p188:cmLst>'

const OLD_AUTHORS =
  `<p:cmAuthorLst xmlns:p="${P_NS}">` +
  '<p:cmAuthor id="0" name="Olena" initials="O" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>'

const MODERN_AUTHORS =
  '<p188:authorLst xmlns:p188="p188">' +
  '<p188:author id="{A1}" name="Petro" initials="P"/></p188:authorLst>'

/** A deck with comments of the kinds asked for. */
async function withComments(kinds: readonly ('old' | 'modern')[]): Promise<OoxmlPackage> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))

  const slideRels = parseRelationships(getPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels') ?? '')
  const deckRels = parseRelationships(getPartText(pkg, 'ppt/_rels/presentation.xml.rels') ?? '')

  if (kinds.includes('old')) {
    setPartText(pkg, 'ppt/comments/comment1.xml', OLD_COMMENTS)
    setPartText(pkg, 'ppt/commentAuthors.xml', OLD_AUTHORS)
    addRelationship(slideRels, COMMENTS_RELATIONSHIP, '../comments/comment1.xml')
    addRelationship(
      deckRels,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors',
      'commentAuthors.xml',
    )
  }

  if (kinds.includes('modern')) {
    setPartText(pkg, 'ppt/comments/modernComment_1.xml', MODERN_COMMENTS)
    setPartText(pkg, 'ppt/authors.xml', MODERN_AUTHORS)
    addRelationship(slideRels, MODERN_COMMENTS_RELATIONSHIP, '../comments/modernComment_1.xml')
    addRelationship(
      deckRels,
      'http://schemas.microsoft.com/office/powerpoint/2018/8/relationships/authors',
      'authors.xml',
    )
  }

  setPartText(pkg, 'ppt/slides/_rels/slide1.xml.rels', serializeRelationships(slideRels))
  setPartText(pkg, 'ppt/_rels/presentation.xml.rels', serializeRelationships(deckRels))
  return pkg
}

const firstSlide = (pkg: OoxmlPackage): Slide => {
  const slide = readDeck(pkg).slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')
  return slide
}

describe('reading what was said', () => {
  it('reads the original format, with the person who said it', async () => {
    const pkg = await withComments(['old'])
    const comments = readComments(pkg, firstSlide(pkg))

    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      author: { name: 'Olena', initials: 'O' },
      text: 'Tighten this up',
      resolved: false,
      editable: true,
    })
  })

  it('reads the one PowerPoint has written since 2018', async () => {
    const pkg = await withComments(['modern'])
    const comments = readComments(pkg, firstSlide(pkg))

    expect(comments[0]).toMatchObject({
      author: { name: 'Petro' },
      text: 'Fixed in the new version',
      resolved: true,
      // Written by something else, in a shape nothing here writes.
      editable: false,
    })
  })

  it('reads both where a deck has been through two versions', async () => {
    const pkg = await withComments(['old', 'modern'])
    expect(readComments(pkg, firstSlide(pkg))).toHaveLength(2)
  })

  it('reads nothing from a deck nobody has commented on', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    expect(readComments(pkg, firstSlide(pkg))).toEqual([])
  })
})

describe('adding one', () => {
  const said = { author: { name: 'Dmytro', initials: 'D' }, text: 'Move this up' }

  it('makes the parts a deck with no comments has none of', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    expect(addComment(pkg, firstSlide(pkg), said)).not.toBeNull()

    const reopened = await readPptxPackage(await saveDeck(pkg))
    const comments = readComments(reopened, firstSlide(reopened))

    expect(comments[0]).toMatchObject({ author: { name: 'Dmytro' }, text: 'Move this up' })
  })

  it('joins the list a slide already has rather than making a second', async () => {
    const pkg = await withComments(['old'])
    addComment(pkg, firstSlide(pkg), said)

    const parts = [...pkg.parts.keys()].filter((path) => path.startsWith('ppt/comments/'))
    expect(parts).toHaveLength(1)
    expect(readComments(pkg, firstSlide(pkg))).toHaveLength(2)
  })

  it('names a person once, however many times they speak', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    addComment(pkg, firstSlide(pkg), said)
    addComment(pkg, firstSlide(pkg), { ...said, text: 'And this' })

    expect(getPartText(pkg, 'ppt/commentAuthors.xml')?.match(/p:cmAuthor /gu)).toHaveLength(1)
  })

  it('refuses a comment with nothing in it', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    expect(addComment(pkg, firstSlide(pkg), { ...said, text: '   ' })).toBeNull()
  })

  it('leaves a deck’s newer comments where they are', async () => {
    const pkg = await withComments(['modern'])
    addComment(pkg, firstSlide(pkg), said)

    // Side by side, as they are in PowerPoint.
    expect(readComments(pkg, firstSlide(pkg))).toHaveLength(2)
    expect(getPartText(pkg, 'ppt/comments/modernComment_1.xml')).toContain('Fixed in the new')
  })
})

describe('taking one away', () => {
  it('removes the one named', async () => {
    const pkg = await withComments(['old'])
    expect(removeComment(pkg, firstSlide(pkg), '1')).toBe(true)

    expect(readComments(pkg, firstSlide(pkg))).toEqual([])
  })

  it('leaves a thread from a newer PowerPoint alone', async () => {
    // Removing one remark from a structure with statuses and replies is a
    // different operation, and doing it badly would lose the conversation.
    const pkg = await withComments(['modern'])
    expect(removeComment(pkg, firstSlide(pkg), '{C1}')).toBe(false)
    expect(readComments(pkg, firstSlide(pkg))).toHaveLength(1)
  })
})

describe('a thread PowerPoint started', () => {
  const threaded = async () => {
    const pkg = await withComments(['modern'])
    return { pkg, slide: firstSlide(pkg) }
  }

  it('is read as one remark with its answers under it', async () => {
    const pkg = await withComments(['modern'])
    setPartText(
      pkg,
      'ppt/comments/modernComment_1.xml',
      MODERN_COMMENTS.replace(
        '</p188:cm>',
        '<p188:replyLst><p188:reply id="{R1}" authorId="{A1}">' +
          '<p188:txBody><a:bodyPr/><a:p><a:r><a:t>Agreed</a:t></a:r></a:p></p188:txBody>' +
          '</p188:reply></p188:replyLst></p188:cm>',
      ),
    )

    const comments = readComments(pkg, firstSlide(pkg))
    expect(comments).toHaveLength(1)
    expect(comments[0]?.replies.map((one) => one.text)).toEqual(['Agreed'])
  })

  it('takes an answer, beside the ones already there', async () => {
    const { pkg, slide } = await threaded()
    expect(
      replyToComment(pkg, slide, '{C1}', {
        author: { name: 'Petro', initials: 'P' },
        text: 'Thanks',
      }),
    ).toBe(true)

    const comments = readComments(pkg, slide)
    expect(comments[0]?.replies[0]).toMatchObject({ text: 'Thanks', author: { name: 'Petro' } })
  })

  it('names a new person in the authors part beside the others', async () => {
    const { pkg, slide } = await threaded()
    replyToComment(pkg, slide, '{C1}', { author: { name: 'Dmytro', initials: 'D' }, text: 'Mine' })

    expect(getPartText(pkg, 'ppt/authors.xml')).toContain('Dmytro')
    expect(readComments(pkg, slide)[0]?.replies[0]?.author.name).toBe('Dmytro')
  })

  it('marks it dealt with, and lets it be reopened', async () => {
    const { pkg, slide } = await threaded()
    expect(resolveComment(pkg, slide, '{C1}', false)).toBe(true)
    expect(readComments(pkg, slide)[0]?.resolved).toBe(false)

    expect(resolveComment(pkg, slide, '{C1}', true)).toBe(true)
    expect(readComments(pkg, slide)[0]?.resolved).toBe(true)
  })

  it('says nothing changed when it already says that', async () => {
    const { pkg, slide } = await threaded()
    expect(resolveComment(pkg, slide, '{C1}', true)).toBe(false)
  })

  it('refuses to answer a remark in the older format', async () => {
    // There are no replies there; another remark is what answering means.
    const pkg = await withComments(['old'])
    const slide = firstSlide(pkg)

    expect(
      replyToComment(pkg, slide, '1', { author: { name: 'Me', initials: 'M' }, text: 'No' }),
    ).toBe(false)
    expect(readComments(pkg, slide)[0]?.threaded).toBe(false)
  })

  it('refuses an answer with nothing in it', async () => {
    const { pkg, slide } = await threaded()
    expect(
      replyToComment(pkg, slide, '{C1}', { author: { name: 'P', initials: 'P' }, text: ' ' }),
    ).toBe(false)
  })
})
