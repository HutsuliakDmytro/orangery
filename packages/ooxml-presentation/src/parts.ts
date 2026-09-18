import { readPackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Where a PresentationML package keeps things.
 *
 * The package machinery is shared with the rest of the suite and knows nothing
 * about `ppt/`; these names are what makes a zip a deck rather than a document.
 */

export const PRESENTATION_PART = 'ppt/presentation.xml'
export const PRESENTATION_RELS_PART = 'ppt/_rels/presentation.xml.rels'
export const PRES_PROPS_PART = 'ppt/presProps.xml'
export const VIEW_PROPS_PART = 'ppt/viewProps.xml'
export const TABLE_STYLES_PART = 'ppt/tableStyles.xml'

/** Reading a `.pptx`: a package without a presentation part is not one. */
export function readPptxPackage(data: ArrayBuffer | Uint8Array): Promise<OoxmlPackage> {
  return readPackage(data, PRESENTATION_PART)
}

const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'

export const SLIDE_RELATIONSHIP = `${RELATIONSHIP}slide`
export const SLIDE_MASTER_RELATIONSHIP = `${RELATIONSHIP}slideMaster`
export const SLIDE_LAYOUT_RELATIONSHIP = `${RELATIONSHIP}slideLayout`
export const NOTES_SLIDE_RELATIONSHIP = `${RELATIONSHIP}notesSlide`
export const NOTES_MASTER_RELATIONSHIP = `${RELATIONSHIP}notesMaster`
export const HANDOUT_MASTER_RELATIONSHIP = `${RELATIONSHIP}handoutMaster`
export const THEME_RELATIONSHIP = `${RELATIONSHIP}theme`
export const COMMENT_AUTHORS_RELATIONSHIP = `${RELATIONSHIP}commentAuthors`
export const COMMENTS_RELATIONSHIP = `${RELATIONSHIP}comments`

/**
 * Comments as PowerPoint has written them since 2018.
 *
 * A second, extension-namespaced relationship beside the old one, and the one
 * a deck from a current PowerPoint actually uses. A map that knew only the
 * standard name would report every modern deck as having no comments, which is
 * worse than not looking.
 */
export const MODERN_COMMENTS_RELATIONSHIP =
  'http://schemas.microsoft.com/office/powerpoint/2018/8/relationships/comments'

/**
 * Both spellings of it.
 *
 * The extension namespace is not a published standard, and the name appears
 * singular in decks and plural in what documentation there is. With no
 * PowerPoint-authored deck in the corpus to pin it with, guessing one would be
 * guessing which half of the decks to read. Reading both costs a comparison and
 * cannot be wrong: a deck carries whichever it carries.
 */
export const MODERN_COMMENTS_RELATIONSHIPS = [
  MODERN_COMMENTS_RELATIONSHIP,
  'http://schemas.microsoft.com/office/powerpoint/2018/8/relationships/comment',
]
export const MODERN_COMMENT_AUTHORS_RELATIONSHIP =
  'http://schemas.microsoft.com/office/powerpoint/2018/8/relationships/authors'

/** What a relationship to a picture, a film or a sound is called. */
export const MEDIA_RELATIONSHIPS = [
  `${RELATIONSHIP}image`,
  `${RELATIONSHIP}audio`,
  `${RELATIONSHIP}video`,
  `${RELATIONSHIP}media`,
]
