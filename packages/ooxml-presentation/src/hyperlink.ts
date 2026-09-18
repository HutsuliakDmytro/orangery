import { partDirectory, parseRelationships, getPartText, resolveTarget } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { Deck } from './deck'
import { relsPartFor } from './insert-picture'
import type { LinkTarget } from './shape-tree'

/**
 * Where a click on a link goes.
 *
 * The format spells three different things the same way. A link to the web is a
 * relationship with an external target; a link to a slide is a relationship to
 * that slide's part; a link to "the next slide" has no target at all and says
 * so in an action, because there is nothing in the package to point at.
 *
 * `ppaction://media` uses the same element and is not a link — it is how a
 * video says it is a video — so it resolves to nothing rather than to a jump
 * somebody never asked for.
 */

export type Hyperlink =
  | { kind: 'url'; url: string }
  /** Index into the deck's slides. */
  | { kind: 'slide'; index: number }
  | { kind: 'jump'; jump: 'first' | 'last' | 'next' | 'previous' | 'end' }

const JUMPS: Record<string, Hyperlink> = {
  firstslide: { kind: 'jump', jump: 'first' },
  lastslide: { kind: 'jump', jump: 'last' },
  nextslide: { kind: 'jump', jump: 'next' },
  previousslide: { kind: 'jump', jump: 'previous' },
  endshow: { kind: 'jump', jump: 'end' },
}

/**
 * Resolves a link found on `part`.
 *
 * Returns null for anything that does not go anywhere we can go: a link to a
 * file on somebody else's disk, an action we do not know, a relationship that
 * is not there.
 */
export function resolveHyperlink(
  pkg: OoxmlPackage,
  deck: Deck,
  part: string,
  link: LinkTarget | null,
): Hyperlink | null {
  if (link === null) return null

  const action = link.action ?? ''
  if (action.startsWith('ppaction://media')) return null

  const named = /^ppaction:\/\/hlinkshowjump\?jump=(\w+)/u.exec(action)
  if (named?.[1] !== undefined) return JUMPS[named[1].toLowerCase()] ?? null

  if (link.relationshipId === null || link.relationshipId === '') return null

  const relationships = parseRelationships(getPartText(pkg, relsPartFor(part)) ?? '')
  const relationship = relationships.get(link.relationshipId)
  if (relationship === undefined) return null

  // An external target is a URL as written; anything else is a path in the
  // package, and the only package paths worth following are slides.
  if (relationship.external) return { kind: 'url', url: relationship.target }

  const target = resolveTarget(relationship.target, partDirectory(part))
  const index = deck.slides.findIndex((slide) => slide.path === target)

  return index === -1 ? null : { kind: 'slide', index }
}
