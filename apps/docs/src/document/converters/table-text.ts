import type { ProseMirrorNodeJson } from '../../ooxml/prosemirror-json'

/**
 * Shared table handling for the text formats.
 *
 * Markdown and HTML both want a rectangular grid of strings, and neither
 * GitHub-flavoured Markdown nor a plain HTML table without `rowspan` can express
 * a merged cell. Flattening is therefore lossy by definition — the alternative,
 * which is what happened before this existed, was concatenating every cell into
 * one unreadable line.
 */

export interface FlatTable {
  rows: string[][]
  /** True when a cell spanned rows or columns and had to be repeated or padded. */
  lostSpans: boolean
}

function cellText(
  cell: ProseMirrorNodeJson,
  inline: (node: ProseMirrorNodeJson) => string,
): string {
  return (cell.content ?? [])
    .map((block) => inline(block))
    .join(' ')
    .trim()
}

function numberAttr(node: ProseMirrorNodeJson, key: string): number {
  const value = node.attrs?.[key]
  return typeof value === 'number' && value > 0 ? value : 1
}

/**
 * Turns a table into a rectangle of strings.
 *
 * A cell spanning columns is repeated across them, and one spanning rows is
 * repeated down them: an empty cell would read as missing data, whereas the
 * repeated value is at least true.
 */
export function flattenTable(
  table: ProseMirrorNodeJson,
  inline: (node: ProseMirrorNodeJson) => string,
): FlatTable {
  const rows: string[][] = []
  let lostSpans = false

  // Cells still covered by a rowspan above, by column index.
  const carried = new Map<number, { text: string; remaining: number }>()

  for (const row of table.content ?? []) {
    const line: string[] = []
    let column = 0

    const placeCarried = () => {
      let carriedCell = carried.get(column)
      while (carriedCell !== undefined && carriedCell.remaining > 0) {
        line[column] = carriedCell.text
        carriedCell.remaining -= 1
        if (carriedCell.remaining === 0) carried.delete(column)
        column += 1
        carriedCell = carried.get(column)
      }
    }

    for (const cell of row.content ?? []) {
      placeCarried()

      const text = cellText(cell, inline)
      const colspan = numberAttr(cell, 'colspan')
      const rowspan = numberAttr(cell, 'rowspan')
      if (colspan > 1 || rowspan > 1) lostSpans = true

      for (let offset = 0; offset < colspan; offset += 1) {
        line[column + offset] = text
        if (rowspan > 1) {
          carried.set(column + offset, { text, remaining: rowspan - 1 })
        }
      }

      column += colspan
    }

    placeCarried()
    rows.push(line)
  }

  // Ragged rows are padded, or a reader lines the columns up wrongly.
  const width = Math.max(0, ...rows.map((row) => row.length))
  for (const row of rows) {
    for (let index = 0; index < width; index += 1) row[index] ??= ''
  }

  return { rows, lostSpans }
}

/** Escapes the pipe, which would otherwise end a Markdown cell early. */
export function escapeTableCell(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

/**
 * A GitHub-flavoured Markdown table.
 *
 * The format requires a header row, so the first row becomes one — Markdown has
 * no way to say "this table has no header", and a table whose first row is data
 * still reads correctly.
 */
export function toMarkdownTable(table: FlatTable): string {
  if (table.rows.length === 0) return ''

  const [header, ...body] = table.rows
  const width = header?.length ?? 0
  if (width === 0) return ''

  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => escapeTableCell(cell)).join(' | ')} |`

  return [
    line(header ?? []),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map((row) => line(row)),
  ].join('\n')
}

/** Reads a Markdown table back, or null when the lines are not one. */
export function parseMarkdownTable(lines: readonly string[]): string[][] | null {
  if (lines.length < 2) return null

  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\||\|$/gu, '')
      .split(/(?<!\\)\|/u)
      .map((cell) => cell.trim().replace(/\\\|/gu, '|'))

  const header = cells(lines[0] ?? '')
  const divider = cells(lines[1] ?? '')

  // The second line must be the divider, or these are ordinary paragraphs that
  // happen to contain pipes.
  const isDivider =
    divider.length === header.length && divider.every((cell) => /^:?-{3,}:?$/u.test(cell))
  if (!isDivider) return null

  return [header, ...lines.slice(2).map((line) => cells(line))]
}

/** Builds a table node from a rectangle of strings. */
export function tableFromRows(rows: readonly (readonly string[])[]): ProseMirrorNodeJson {
  return {
    type: 'table',
    content: rows.map((row) => ({
      type: 'tableRow',
      content: row.map((text) => ({
        type: 'tableCell',
        attrs: { colspan: 1, rowspan: 1 },
        content: [
          text === ''
            ? { type: 'paragraph' }
            : { type: 'paragraph', content: [{ type: 'text', text }] },
        ],
      })),
    })),
  }
}
