import { element, textNode } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * Word's complex fields.
 *
 * A field is a `begin` marker, the instruction, a `separate` marker, the result
 * as it was last calculated, and an `end` marker. Every reader shows the cached
 * result until someone asks Word to update the field, which is what makes a
 * number in a document both automatic and readable by something that cannot
 * calculate it.
 */

function run(children: XmlNode[]): XmlNode {
  return element('w:r', {}, children)
}

function fieldChar(type: 'begin' | 'separate' | 'end'): XmlNode {
  return run([
    element('w:fldChar', {
      'w:fldCharType': type,
      // `dirty` asks Word to recalculate on open, so a stale cached value is
      // corrected the first time the document is looked at.
      ...(type === 'begin' ? { 'w:dirty': 'true' } : {}),
    }),
  ])
}

/**
 * A field, with the value to show until it is recalculated.
 *
 * The instruction is written with the spaces Word puts around it; a field code
 * without them is one Word reads as part of the name.
 */
export function complexField(instruction: string, cachedValue: string): XmlNode[] {
  return [
    fieldChar('begin'),
    run([element('w:instrText', { 'xml:space': 'preserve' }, [textNode(instruction)])]),
    fieldChar('separate'),
    run([element('w:t', { 'xml:space': 'preserve' }, [textNode(cachedValue)])]),
    fieldChar('end'),
  ]
}

/** Counts items of one kind — figures, tables — in the order they appear. */
export function sequenceField(name: string, cachedValue: string, chapterLevel?: number): XmlNode[] {
  // `\s 1` restarts the count at every Heading 1 and prints the chapter with it,
  // which is what makes a caption read "1.2" rather than "2".
  const restart = chapterLevel === undefined ? '' : ` \\s ${String(chapterLevel)}`
  return complexField(` SEQ ${name} \\* ARABIC${restart} `, cachedValue)
}

/** The number of the nearest heading of a level, used in front of a sequence. */
export function styleReferenceField(level: number, cachedValue: string): XmlNode[] {
  return complexField(` STYLEREF ${String(level)} \\s `, cachedValue)
}
