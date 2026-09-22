/**
 * Differences a round-trip is allowed to have.
 *
 * A structural diff between the file that went in and the file that came out
 * is not automatically a bug: `compareXml` already ignores Word's revision-save
 * ids and attribute order, and what is left still contains things two writers
 * legitimately disagree about. Each rule here says what is being forgiven and
 * why, so that "allowed" is a decision somebody made rather than a diff nobody
 * read.
 *
 * Anything not matched by a rule is `unknown` and gets an issue. Nothing here
 * changes what the comparison sees — this only sorts what it reports.
 */

export interface Rule {
  id: string
  why: string
  /** The part the difference is in, e.g. `word/document.xml`. */
  part?: RegExp
  /** The element path `compareXml` gives, e.g. `/w:document/w:body[3]`. */
  path?: RegExp
  /** The message, e.g. `attribute w:val differs: 0 vs false`. */
  message?: RegExp
}

export const RULES: Rule[] = [
  {
    id: 'proof-state',
    why: 'Spell-check state: Word recomputes `w:proofErr` on every save and does not keep it across one, so dropping it loses nothing a reader would see.',
    message: /<w:proofErr>/,
  },
  {
    id: 'last-rendered-page-break',
    why: "`w:lastRenderedPageBreak` records where the writer's own layout engine broke the page. Ours is not Word's, and Word rewrites it on save regardless.",
    message: /lastRenderedPageBreak/,
  },
  {
    id: 'boolean-spelling',
    why: 'ECMA-376 lets a boolean attribute be `1`/`0` or `true`/`false`; writers differ and readers must take either.',
    message: /attribute [\w:]+ differs: (1 vs true|true vs 1|0 vs false|false vs 0)$/,
  },
  {
    id: 'xml-space-added',
    why: 'We write `xml:space="preserve"` on every `w:t`; Word writes it only when the text has an edge space. Adding it never changes what the text is, and leaving it off when the text does have an edge space would.',
    message: /attribute xml:space differs: undefined vs preserve$/,
  },
  {
    id: 'section-reference-order',
    why: 'Within `w:sectPr` the header and footer references are one repeated group in the schema, and each says which pages it is for in its own `w:type`. Writing every header and then every footer says exactly what an interleaved list says; the comparison notices only because it walks children by position.',
    part: /word\//,
    path: /w:sectPr(\[\d+\])?(\/w:(header|footer)Reference)?$/,
    message:
      /element differs: <w:(header|footer)Reference> vs <w:(header|footer)Reference>$|attribute (w:type|r:id) differs: \S+ vs \S+$/,
  },
  {
    id: 'implied-default-written',
    why: 'An attribute we write with the value the schema already defaults to: `w:gutter="0"` on a page, `w:fmt="decimal"` on page numbering. A reader that honours the default reads the same document either way.',
    part: /word\//,
    message:
      /attribute w:(gutter|fmt|gutterAtTop) differs: undefined vs (0|decimal|false)$|attribute w:(gutter|gutterAtTop) differs: 0 vs undefined$/,
  },
  {
    id: 'implied-default-dropped',
    why: 'An attribute written with the value the schema already defaults to: `t="n"` on a cell, `collapsed="false"` or `hidden="false"` on a column. A reader that honours the default reads the same sheet either way.',
    part: /^xl\//,
    message:
      /attribute (t|collapsed|hidden|customFormat|customHeight|thickBot|thickTop) differs: (n|false|0) vs undefined$|attribute customWidth differs: undefined vs 1$/,
  },
  {
    id: 'trailing-zero',
    why: 'A number written `16.0` and read back `16`. The attribute is a double in the schema and the two spell the same one.',
    message:
      /attribute [\w:]+ differs: (\d+)\.0+ vs \1$|attribute [\w:]+ differs: (\d+) vs \2\.0+$/,
  },
  {
    id: 'default-on-omitted',
    why: 'A toggle written without `w:val` means on; writing `w:val="1"` says the same thing in longer form.',
    message:
      /attribute w:val differs: (undefined vs 1|1 vs undefined|undefined vs true|true vs undefined)$/,
  },
]

export interface Classified {
  rule: string | null
  why: string | null
}

export function classify(part: string, path: string, message: string): Classified {
  for (const rule of RULES) {
    if (rule.part !== undefined && !rule.part.test(part)) continue
    if (rule.path !== undefined && !rule.path.test(path)) continue
    if (rule.message !== undefined && !rule.message.test(message)) continue
    return { rule: rule.id, why: rule.why }
  }

  return { rule: null, why: null }
}

/**
 * Parts a save is allowed to add or drop.
 *
 * Same idea as the rules above, one level up: the difference is a whole part
 * rather than an element inside one.
 */
export const PART_RULES: {
  id: string
  why: string
  part: RegExp
  direction: 'added' | 'removed'
}[] = [
  {
    id: 'calcchain-dropped',
    why: 'A workbook that was edited is saved without `xl/calcChain.xml`. The chain is a cache of the order Excel last evaluated formulas in; a stale one makes Excel recalculate wrongly, and Excel rebuilds a missing one on open. Dropping it is the documented behaviour of `writeWorkbook`, not a loss.',
    part: /^xl\/calcChain\.xml$/,
    direction: 'removed',
  },
]

export function classifyPart(part: string, direction: 'added' | 'removed'): Classified {
  for (const rule of PART_RULES) {
    if (rule.direction !== direction) continue
    if (!rule.part.test(part)) continue
    return { rule: rule.id, why: rule.why }
  }
  return { rule: null, why: null }
}
