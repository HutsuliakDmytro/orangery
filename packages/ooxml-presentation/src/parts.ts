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
