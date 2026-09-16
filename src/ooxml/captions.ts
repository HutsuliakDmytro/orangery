/**
 * Numbering captions — "Figure 1", or "Figure 1.2" in a document whose chapters
 * are numbered.
 *
 * Computed from the document for the same reason heading numbers are: a number
 * typed into a caption is wrong the moment a figure is inserted above it, and
 * renumbering by hand is the work the field exists to avoid.
 *
 * The counting is stated once, over the least a caller has to know about a
 * block. The editor walks its own nodes and the serializer walks the JSON, and
 * neither can count differently from the other.
 */

export type CaptionKind = 'figure' | 'table'

export const CAPTION_KINDS: readonly CaptionKind[] = ['figure', 'table']

/** The Word sequence each kind counts in; the name is what ties the two. */
export const SEQUENCE_NAMES: Readonly<Record<CaptionKind, string>> = {
  figure: 'Figure',
  table: 'Table',
}

/** The little a block has to say for it to be counted. */
export interface CaptionSource {
  /** Node type name; only `heading` is treated specially. */
  type: string
  level?: number | undefined
  captionKind?: CaptionKind | undefined
}

export interface CaptionNumber {
  /** Index into the blocks that were handed in. */
  index: number
  kind: CaptionKind
  /** What goes in front of the caption, e.g. `1.2`. */
  number: string
  /** The chapter it belongs to, or null when chapters are not numbered. */
  chapter: number | null
}

export function captionKindOf(value: unknown): CaptionKind | undefined {
  return value === 'figure' || value === 'table' ? value : undefined
}

/**
 * Numbers the captions among a run of blocks.
 *
 * `chapters` restarts the count at each top-level heading and prints that
 * heading's number in front, which is Word's `\s 1` switch and what a long
 * document is expected to do.
 */
export function numberCaptions(
  blocks: readonly CaptionSource[],
  chapters: boolean,
): CaptionNumber[] {
  const counts: Record<CaptionKind, number> = { figure: 0, table: 0 }
  const numbers: CaptionNumber[] = []
  let chapter = 0

  blocks.forEach((block, index) => {
    if (block.type === 'heading' && chapters && block.level === 1) {
      chapter += 1
      counts.figure = 0
      counts.table = 0
      return
    }

    const kind = block.captionKind
    if (kind === undefined) return

    counts[kind] += 1

    numbers.push({
      index,
      kind,
      number: chapters ? `${String(chapter)}.${String(counts[kind])}` : String(counts[kind]),
      chapter: chapters ? chapter : null,
    })
  })

  return numbers
}
