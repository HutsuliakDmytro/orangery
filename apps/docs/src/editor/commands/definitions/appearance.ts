import { requestPicker } from '../picker-store'
import type { Command } from '../types'

/**
 * Parameterised formatting. Each command opens its picker; the picker applies the
 * value through the editor. The registry stays argument-free — see ADR 0002.
 */
export const appearanceCommands: readonly Command[] = [
  {
    id: 'format.text-color',
    label: 'Text Color…',
    group: 'format',
    keywords: ['colour', 'foreground', 'font color'],
    run: () => {
      requestPicker('text-color')
    },
    isActive: ({ editor }) =>
      editor.isActive('textStyle') && Boolean(editor.getAttributes('textStyle')['color']),
  },
  {
    id: 'format.highlight',
    label: 'Highlight Color…',
    group: 'format',
    keywords: ['marker', 'background', 'colour'],
    run: () => {
      requestPicker('highlight')
    },
    isActive: ({ editor }) => editor.isActive('highlight'),
  },
  {
    id: 'format.remove-highlight',
    label: 'Remove Highlight',
    group: 'format',
    keywords: ['unmark', 'clear marker'],
    run: ({ editor }) => {
      editor.chain().focus().unsetHighlight().run()
    },
    isEnabled: ({ editor }) => editor.isActive('highlight'),
  },
  {
    id: 'format.font-family',
    label: 'Font…',
    group: 'format',
    keywords: ['typeface', 'family'],
    run: () => {
      requestPicker('font-family')
    },
  },
  {
    id: 'format.font-size',
    label: 'Font Size…',
    group: 'format',
    keywords: ['points', 'pt', 'bigger', 'smaller'],
    run: () => {
      requestPicker('font-size')
    },
  },
]
