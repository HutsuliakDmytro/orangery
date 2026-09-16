import { DEFAULT_FONT_SIZE, FONT_SIZE_PRESETS } from '../../extensions/font-size'
import { applyFormat, copyFormat, heldFormat } from '../format-painter'
import type { Command } from '../types'

/**
 * Character-level formatting. Shortcuts match Word and Google Docs — see the
 * "Familiar, not novel" principle in CLAUDE.md.
 */
const marks: readonly Command[] = [
  {
    id: 'format.bold',
    label: 'Bold',
    group: 'format',
    shortcut: 'Mod+b',
    keywords: ['strong', 'weight'],
    run: ({ editor }) => {
      editor.chain().focus().toggleBold().run()
    },
    isActive: ({ editor }) => editor.isActive('bold'),
    isEnabled: ({ editor }) => editor.can().chain().toggleBold().run(),
  },
  {
    id: 'format.italic',
    label: 'Italic',
    group: 'format',
    shortcut: 'Mod+i',
    keywords: ['emphasis', 'oblique'],
    run: ({ editor }) => {
      editor.chain().focus().toggleItalic().run()
    },
    isActive: ({ editor }) => editor.isActive('italic'),
    isEnabled: ({ editor }) => editor.can().chain().toggleItalic().run(),
  },
  {
    id: 'format.underline',
    label: 'Underline',
    group: 'format',
    shortcut: 'Mod+u',
    run: ({ editor }) => {
      editor.chain().focus().toggleUnderline().run()
    },
    isActive: ({ editor }) => editor.isActive('underline'),
    isEnabled: ({ editor }) => editor.can().chain().toggleUnderline().run(),
  },
  {
    id: 'format.strike',
    label: 'Strikethrough',
    group: 'format',
    shortcut: 'Mod+Shift+x',
    keywords: ['strikeout', 'cross out'],
    run: ({ editor }) => {
      editor.chain().focus().toggleStrike().run()
    },
    isActive: ({ editor }) => editor.isActive('strike'),
    isEnabled: ({ editor }) => editor.can().chain().toggleStrike().run(),
  },
  {
    id: 'format.superscript',
    label: 'Superscript',
    group: 'format',
    // Word uses Mod+Shift+Plus; the bare key is `=` on most layouts.
    shortcut: 'Mod+.',
    keywords: ['raised', 'power', 'exponent'],
    run: ({ editor }) => {
      editor.chain().focus().toggleSuperscript().run()
    },
    isActive: ({ editor }) => editor.isActive('superscript'),
    isEnabled: ({ editor }) => editor.can().chain().toggleSuperscript().run(),
  },
  {
    id: 'format.subscript',
    label: 'Subscript',
    group: 'format',
    shortcut: 'Mod+,',
    keywords: ['lowered', 'index'],
    run: ({ editor }) => {
      editor.chain().focus().toggleSubscript().run()
    },
    isActive: ({ editor }) => editor.isActive('subscript'),
    isEnabled: ({ editor }) => editor.can().chain().toggleSubscript().run(),
  },
]

/**
 * Size steps walk the preset ladder rather than adding a fixed amount, so
 * stepping up from 11 lands on 12 like it does in Word.
 */
function steppedSize(current: number, direction: 1 | -1): number {
  const ladder = [...FONT_SIZE_PRESETS]
  if (direction === 1) {
    return ladder.find((size) => size > current) ?? (ladder.at(-1) as number)
  }
  return [...ladder].reverse().find((size) => size < current) ?? (ladder[0] as number)
}

function currentFontSize(attributes: Record<string, unknown>): number {
  const size = attributes['fontSize']
  return typeof size === 'number' ? size : DEFAULT_FONT_SIZE
}

const sizing: readonly Command[] = [
  {
    id: 'format.increase-font-size',
    label: 'Increase Font Size',
    group: 'format',
    shortcut: 'Mod+Shift+.',
    keywords: ['bigger', 'larger', 'grow'],
    run: ({ editor }) => {
      const next = steppedSize(currentFontSize(editor.getAttributes('textStyle')), 1)
      editor.chain().focus().setFontSize(next).run()
    },
  },
  {
    id: 'format.decrease-font-size',
    label: 'Decrease Font Size',
    group: 'format',
    shortcut: 'Mod+Shift+,',
    keywords: ['smaller', 'shrink'],
    run: ({ editor }) => {
      const next = steppedSize(currentFontSize(editor.getAttributes('textStyle')), -1)
      editor.chain().focus().setFontSize(next).run()
    },
  },
]

const clearing: readonly Command[] = [
  {
    id: 'format.clear',
    label: 'Clear Formatting',
    group: 'format',
    shortcut: 'Mod+\\',
    keywords: ['remove', 'reset', 'plain'],
    run: ({ editor }) => {
      // Marks and block type both go: Docs resets the paragraph style too.
      editor.chain().focus().unsetAllMarks().clearNodes().run()
    },
  },
]

/**
 * The format painter, as two halves of one gesture.
 *
 * Word makes it a single armed button; two named commands do the same work and
 * are reachable from the keyboard, the menu and the palette without a mode to
 * get stuck in.
 */
const painter: readonly Command[] = [
  {
    id: 'format.copy-formatting',
    label: 'Copy Formatting',
    group: 'format',
    shortcut: 'Mod+Alt+C',
    keywords: ['painter', 'brush', 'style'],
    run: ({ editor }) => {
      copyFormat(editor)
    },
    isActive: () => heldFormat() !== null,
  },
  {
    id: 'format.paste-formatting',
    label: 'Paste Formatting',
    group: 'format',
    shortcut: 'Mod+Alt+V',
    keywords: ['painter', 'brush', 'apply'],
    run: ({ editor }) => {
      applyFormat(editor)
    },
    isEnabled: () => heldFormat() !== null,
  },
]

export const formatCommands: readonly Command[] = [...marks, ...sizing, ...clearing, ...painter]
