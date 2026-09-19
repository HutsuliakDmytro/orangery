import { CONTENT_TYPES_PART, getPartText, isTextPart } from './package'
import type { OoxmlPackage } from './package'
import { contentTypeOf } from './media'
import { parseRelationships, resolveTarget } from './relationships'
import { children, parseXml, tagName } from './xml'
import type { XmlNode } from './xml'

/**
 * Whether a package is still a package.
 *
 * Every rule here is one that Word or PowerPoint enforces by refusing to open
 * the file and offering to repair it, and that nothing in this codebase notices
 * on its own. The readers are lenient by design — they look for an element by
 * name and ignore what they were not asked about — so a part with two XML
 * declarations, a relationship pointing at a file nobody copied, or a new part
 * nothing declares reads back perfectly here and is a broken deck everywhere
 * else.
 *
 * That is not a hypothesis. Writing a part as
 * `withDeclaration(buildXml(parseXml(text)))` put a second declaration into
 * every part two dozen functions touched, and it was found by a test that
 * happened to write one part twice — not by any of the tests about what those
 * functions do.
 *
 * Read-only, and cheap enough to run over a whole corpus: it parses what is
 * already parsed everywhere else.
 */

export interface PackageProblem {
  /** The part the problem is in, as the package names it. */
  part: string
  /** What is wrong, in the words a person fixing it would use. */
  says: string
}

/** Attributes that name a relationship rather than a value. */
const RELATIONSHIP_ATTRIBUTES = new Set([
  '@_r:id',
  '@_r:embed',
  '@_r:link',
  '@_r:pict',
  '@_r:dm',
  '@_r:lo',
  '@_r:qs',
  '@_r:cs',
  '@_r:href',
])

/** The rels part that belongs to a part, whether or not there is one. */
function relsPartFor(path: string): string {
  const cut = path.lastIndexOf('/')
  return `${path.slice(0, cut)}/_rels/${path.slice(cut + 1)}.rels`
}

/** Every relationship id named anywhere in a parsed part. */
function idsNamedIn(node: XmlNode): string[] {
  const attributes = node[':@']
  const own =
    attributes === undefined || attributes === null
      ? []
      : Object.entries(attributes as Record<string, unknown>).flatMap(([name, value]) =>
          RELATIONSHIP_ATTRIBUTES.has(name) && typeof value === 'string' && value !== ''
            ? [value]
            : [],
        )

  return [...own, ...children(node).flatMap(idsNamedIn)]
}

/** Parts that are relationship files rather than content. */
const isRelsPart = (path: string): boolean => path.endsWith('.rels')

/**
 * Everything wrong with a package, in the order the parts are in.
 *
 * An empty list is the only good answer; each entry is one thing a person can
 * go and look at.
 */
export function problemsIn(pkg: OoxmlPackage): PackageProblem[] {
  const problems: PackageProblem[] = []
  const say = (part: string, says: string) => {
    problems.push({ part, says })
  }

  if (!pkg.parts.has(CONTENT_TYPES_PART)) {
    say(CONTENT_TYPES_PART, 'the package declares nothing: there is no content types part')
    return problems
  }

  for (const [path, part] of pkg.parts) {
    // The content types part declares the others and is not one of them; a
    // real package happens to cover it with the default for `xml`, which is
    // the sort of accident a check should not lean on.
    const declared = path === CONTENT_TYPES_PART || contentTypeOf(pkg, path) !== null

    if (!isTextPart(path) || part.text === undefined) {
      if (!declared) say(path, 'nothing declares what this part is')
      continue
    }

    const roots = parseXml(part.text)
    const declarations = roots.filter((node) => (tagName(node) ?? '').startsWith('?xml'))
    const elements = roots.filter((node) => {
      const tag = tagName(node) ?? ''
      return tag !== '' && !tag.startsWith('?') && tag !== '#text'
    })

    if (declarations.length > 1) {
      // Two prologs is not well-formed XML. The readers here look for an
      // element by name and never notice; PowerPoint offers to repair the file.
      say(path, `${String(declarations.length)} XML declarations, and a file may have one`)
    }
    if (elements.length !== 1) {
      say(path, `${String(elements.length)} root elements, and a file has exactly one`)
    }

    if (isRelsPart(path) || path === CONTENT_TYPES_PART) continue
    if (!declared) say(path, 'nothing declares what this part is')

    const relationships = parseRelationships(getPartText(pkg, relsPartFor(path)) ?? '')
    const base = path.slice(0, path.lastIndexOf('/'))

    for (const relationship of relationships.values()) {
      if (relationship.external) continue

      const target = resolveTarget(relationship.target, base)
      if (!pkg.parts.has(target)) {
        say(path, `${relationship.id} points at ${target}, which is not in the package`)
      }
    }

    for (const id of new Set(roots.flatMap(idsNamedIn))) {
      if (!relationships.has(id)) {
        say(path, `names ${id}, which its relationships do not`)
      }
    }
  }

  return problems
}

/** The problems as lines, for a message that has to say what is wrong. */
export function describeProblems(problems: readonly PackageProblem[]): string {
  return problems.map((problem) => `${problem.part}: ${problem.says}`).join('\n')
}
