import { Extension } from '@tiptap/core'

/**
 * Paragraph indentation, mapping onto OOXML `w:ind` (`w:left`, `w:right`,
 * `w:firstLine`/`w:hanging`). Values are points; Word stores twips.
 *
 * Inside a list, indenting means changing nesting depth, so the Tab handler
 * defers to the list extensions and only falls back to `w:ind` outside them.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
      setIndent: (indent: { left?: number; right?: number; firstLine?: number }) => ReturnType
      unsetIndent: () => ReturnType
    }
  }
}

/** Word's default tab stop: half an inch. */
export const INDENT_STEP_PT = 36

export const MAX_INDENT_PT = 36 * 20

export function clampIndent(points: number): number {
  if (!Number.isFinite(points)) return 0
  return Math.min(MAX_INDENT_PT, Math.max(0, Math.round(points)))
}

function parsePoints(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null
}

export interface IndentOptions {
  types: string[]
}

export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indentLeft: {
            default: null,
            parseHTML: (element: HTMLElement) => parsePoints(element.style.marginLeft),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['indentLeft']
              if (typeof value !== 'number' || value === 0) return {}
              return { style: `margin-left: ${String(value)}pt` }
            },
          },
          indentRight: {
            default: null,
            parseHTML: (element: HTMLElement) => parsePoints(element.style.marginRight),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['indentRight']
              if (typeof value !== 'number' || value === 0) return {}
              return { style: `margin-right: ${String(value)}pt` }
            },
          },
          /** Negative means a hanging indent, which Word stores as `w:hanging`. */
          indentFirstLine: {
            default: null,
            parseHTML: (element: HTMLElement) => parsePoints(element.style.textIndent),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes['indentFirstLine']
              if (typeof value !== 'number' || value === 0) return {}
              return { style: `text-indent: ${String(value)}pt` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ editor, commands }) => {
          const next = clampIndent(currentIndent(editor) + INDENT_STEP_PT)
          return this.options.types.every((type) =>
            commands.updateAttributes(type, { indentLeft: next }),
          )
        },

      outdent:
        () =>
        ({ editor, commands }) => {
          const next = clampIndent(currentIndent(editor) - INDENT_STEP_PT)
          return this.options.types.every((type) =>
            commands.updateAttributes(type, { indentLeft: next === 0 ? null : next }),
          )
        },

      setIndent:
        (indent: { left?: number; right?: number; firstLine?: number }) =>
        ({ commands }) => {
          const attributes: Record<string, number> = {}
          if (indent.left !== undefined) attributes['indentLeft'] = clampIndent(indent.left)
          if (indent.right !== undefined) attributes['indentRight'] = clampIndent(indent.right)
          // First-line indent may be negative (hanging), so it is not clamped to >= 0.
          if (indent.firstLine !== undefined) attributes['indentFirstLine'] = indent.firstLine
          return this.options.types.every((type) => commands.updateAttributes(type, attributes))
        },

      unsetIndent:
        () =>
        ({ commands }) =>
          this.options.types.every((type) =>
            commands.resetAttributes(type, ['indentLeft', 'indentRight', 'indentFirstLine']),
          ),
    }
  },
})

interface AttributeReader {
  isActive: (name: string) => boolean
  getAttributes: (name: string) => Record<string, unknown>
}

/** Left indent of the block at the cursor, in points; 0 when unset. */
function currentIndent(editor: AttributeReader): number {
  const blockType = editor.isActive('heading') ? 'heading' : 'paragraph'
  const value = editor.getAttributes(blockType)['indentLeft']
  return typeof value === 'number' ? value : 0
}
