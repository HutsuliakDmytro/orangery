/**
 * Matching one element in a part we read as text rather than as a tree.
 *
 * A worksheet is scanned rather than parsed — half a million rows is thirty
 * million nodes and a DOM of it is a tab that stops responding — and a scanner
 * matches elements with regular expressions. Writing those by hand is where
 * this file comes from: the obvious pattern is wrong, quietly, on input every
 * real workbook contains.
 *
 * ```
 * /<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/
 * ```
 *
 * `[^>]*` is greedy and takes the `/` of `<c r="A1" s="1"/>` with it. The
 * engine then tries `\/>` against the `>` that is left, fails, and takes the
 * `>` branch instead — so the match runs from that cell to the *next*
 * `</c>`, swallowing every cell in between and taking that cell's `<v>` as its
 * own. An empty styled cell is in nearly every sheet anybody has, and the cell
 * after it ends up holding somebody else's number.
 *
 * The fix is that the attributes must not be allowed to eat the slash. Lazy
 * rather than greedy, with the whitespace before the close taken separately:
 * the engine then stops at the first `/>` or `>` it can, which is the one that
 * belongs to this element.
 */

/**
 * One element, open or self-closed: `<c …/>` or `<c …>…</c>`.
 *
 * Group 1 is the attributes, with the leading space, or undefined. Group 2 is
 * the content, or undefined for the self-closed form. Nesting an element in
 * one of its own kind is not supported and nothing in SpreadsheetML does it.
 */
export function elementPattern(name: string, flags = 'u'): RegExp {
  return new RegExp(`<${name}(\\s[^>]*?)?\\s*(?:/>|>([\\s\\S]*?)</${name}>)`, flags)
}

/**
 * The start of an element, wherever it ends: `<sheetData …>` or `<sheetData/>`.
 *
 * What a writer wants when it is looking for the place to insert something
 * before or after, rather than for the element itself.
 */
export function openingPattern(name: string, flags = 'u'): RegExp {
  return new RegExp(`<${name}(?:\\s[^>]*?)?\\s*(?:/>|>)`, flags)
}

/** The self-closed form alone: `<sheetData/>`, which has nothing to insert into. */
export function selfClosedPattern(name: string, flags = 'u'): RegExp {
  return new RegExp(`<${name}(?:\\s[^>]*?)?\\s*/>`, flags)
}
