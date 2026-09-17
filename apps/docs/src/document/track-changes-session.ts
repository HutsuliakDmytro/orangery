import {
  attribute,
  buildXml,
  children,
  element,
  getPartText,
  parseToggle,
  parseXml,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { SETTINGS_PART } from '../ooxml/parts'

/**
 * Whether the document records edits as tracked changes — `w:trackChanges`.
 *
 * A property of the document rather than of the app: a reviewer turns it on for
 * the file they were sent, and the next person to open that file should find it
 * still on rather than have to know to switch it on themselves.
 */

const FLAG = 'w:trackChanges'

export function readTrackChanges(pkg: OoxmlPackage): boolean {
  const xml = getPartText(pkg, SETTINGS_PART)
  if (xml === undefined) return false

  const root = parseXml(xml).find((node) => tagName(node) === 'w:settings')
  if (!root) return false

  const flag = children(root).find((node) => tagName(node) === FLAG)
  return flag !== undefined && parseToggle(attribute(flag, 'w:val'))
}

/**
 * Writes the flag, or takes it out.
 *
 * The element's absence is what "not recording" means, so turning the mode off
 * removes it rather than writing a nay-saying one — which is what Word does and
 * what keeps a file that never had the element unchanged.
 */
export function writeTrackChanges(pkg: OoxmlPackage, on: boolean): void {
  const xml = getPartText(pkg, SETTINGS_PART)
  if (xml === undefined) return

  const roots = parseXml(xml)
  const root = roots.find((node) => tagName(node) === 'w:settings')
  if (!root) return

  const list: unknown = root['w:settings']
  if (!Array.isArray(list)) return

  const settings = list as XmlNode[]
  const at = settings.findIndex((node) => tagName(node) === FLAG)

  if (!on) {
    if (at !== -1) settings.splice(at, 1)
  } else if (at === -1) {
    // `w:trackChanges` comes early among the settings; ahead of everything is
    // within what the schema allows and keeps the rest in the order it had.
    settings.unshift(element(FLAG))
  }

  setPartText(pkg, SETTINGS_PART, withDeclaration(buildXml(roots)))
}
