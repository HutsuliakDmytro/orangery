import { writeTextBody } from '@orangery/ooxml-drawingml'
import type { PmNode } from '@orangery/ooxml-drawingml'
import { ensureTextBody } from './write-shape'
import type { Shape } from './shape-tree'

/**
 * Putting plain lines into a shape.
 *
 * What the editor writes goes through ProseMirror, because typing is what it is
 * for. Everything else that produces text — a template, an outline pasted in,
 * a generated deck — has lines and indent levels and nothing else, and making
 * it build an editor document first would be asking it to speak a language it
 * has no use for.
 *
 * The level is the outline level, the same one Tab and Shift+Tab move between;
 * what it looks like is the master's business, which is the point of writing
 * the level rather than a bullet character.
 */

export interface TextLine {
  text: string
  /** Outline level, zero-based. */
  level?: number
}

export function setShapeText(shape: Shape, lines: readonly TextLine[]): boolean {
  // A shape drawn without words has no text body to write into, and the one
  // made here is the same one entering the shape in the editor would make.
  ensureTextBody(shape)
  if (shape.text === null) return false

  const doc: PmNode = {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      attrs: { level: line.level ?? 0 },
      // An empty line is a paragraph with nothing in it, not a paragraph
      // holding an empty run: the second is what PowerPoint writes when someone
      // deletes a word, and it carries that word's formatting with it.
      ...(line.text === '' ? {} : { content: [{ type: 'text', text: line.text }] }),
    })),
  }

  return writeTextBody(shape.text.node, doc)
}
