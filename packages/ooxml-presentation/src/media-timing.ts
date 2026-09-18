import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'

/**
 * Which media on a slide starts on its own.
 *
 * `p:timing` is not modelled and does not need to be for this: a film or a
 * sound has a node of its own in it, and that node says when it begins. A start
 * condition of `indefinite` means "when somebody asks", which is the click; a
 * delay in milliseconds means it begins with the slide.
 *
 * Reading only this much of the timing is the point. The rest of it describes
 * animations that do not play here, and a parser that had to understand them to
 * answer this question would be a parser that answers it wrongly the first time
 * it meets an effect nobody thought of.
 */

/** Walks a subtree for every element with this name. */
function descendants(node: XmlNode, tag: string): XmlNode[] {
  const found: XmlNode[] = []

  for (const child of children(node)) {
    if (tagName(child) === tag) found.push(child)
    found.push(...descendants(child, tag))
  }

  return found
}

/** The shape a media node points at, by id. */
function targetOf(media: XmlNode): number | null {
  const target = findChild(media, 'p:tgtEl')
  const shape = target === undefined ? undefined : findChild(target, 'p:spTgt')
  const id = Number(shape === undefined ? undefined : attribute(shape, 'spid'))

  return Number.isFinite(id) ? id : null
}

/** Whether a media node waits to be asked. */
function waitsForAClick(media: XmlNode): boolean {
  const timing = findChild(media, 'p:cTn')
  const conditions = timing === undefined ? undefined : findChild(timing, 'p:stCondLst')
  if (conditions === undefined) return false

  return children(conditions).some(
    (condition) =>
      tagName(condition) === 'p:cond' && attribute(condition, 'delay') === 'indefinite',
  )
}

/**
 * The shape ids of the media that start with the slide.
 *
 * Empty for a slide with no timing at all, which is every deck where somebody
 * dropped a film in and never opened the animation pane: PowerPoint plays those
 * on a click, and so do we.
 */
export function autoplayShapes(part: SlidePart): Set<number> {
  const timing = findChild(part.root, 'p:timing')
  if (timing === undefined) return new Set()

  const started = new Set<number>()

  for (const tag of ['p:video', 'p:audio']) {
    for (const node of descendants(timing, tag)) {
      const media = findChild(node, 'p:cMediaNode')
      if (media === undefined) continue

      const id = targetOf(media)
      if (id !== null && !waitsForAClick(media)) started.add(id)
    }
  }

  return started
}
