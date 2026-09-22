/**
 * The OOXML package, independent of what it holds.
 *
 * Nothing here knows whether it is looking at a document, a deck or a
 * spreadsheet. A module that needs to know belongs in the app, or in the
 * format's own package — see `docs/adr/0001-monorepo.md`.
 */

export {
  CONTENT_TYPES_PART,
  getPartText,
  isTextPart,
  mainPartOf,
  OoxmlFormatError,
  readPackage,
  relsPartFor,
  setPartText,
  writePackage,
} from './package'
export type { OoxmlPackage, OoxmlPart, PackageExpectation } from './package'

export {
  addRelationship,
  findByTarget,
  HYPERLINK_RELATIONSHIP,
  IMAGE_RELATIONSHIP,
  nextRelationshipId,
  partDirectory,
  parseRelationships,
  resolveTarget,
  serializeRelationships,
  writeRelationships,
} from './relationships'
export type { Relationship } from './relationships'

export { decodeBytes, encodeBytes } from './base64'
export { declarationOf, preservingRoot, rootAttributesOf, setPartXml } from './preserve'
export * from './xml'
export * from './units'
export { compareXml, describeDifferences } from './compare'
export type { XmlDifference } from './compare'
export {
  ensureChild,
  hasAttribute,
  removeAttribute,
  removeChild,
  setAttribute,
  upsertChild,
} from './edit'
export { describeProblems, problemsIn } from './validate'
export type { PackageProblem } from './validate'

export { addMedia, contentTypeOf, ensureContentType, ensureOverride, nextMediaName } from './media'
export type { AddedMedia, MediaRequest } from './media'
