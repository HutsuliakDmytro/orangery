import { imageActions } from '../image-actions'
import { requestPicker } from '../picker-store'
import type { Command } from '../types'

const WRAPS = [
  { value: 'inline', label: 'In Line with Text' },
  { value: 'left', label: 'Wrap Text — Image Left' },
  { value: 'right', label: 'Wrap Text — Image Right' },
  { value: 'topAndBottom', label: 'Break Text' },
] as const

export const imageCommands: readonly Command[] = [
  {
    id: 'insert.image',
    label: 'Image…',
    group: 'insert',
    keywords: ['picture', 'photo', 'figure'],
    run: ({ editor }) => {
      void imageActions.insertFromFile(editor)
    },
  },
  ...WRAPS.map(({ value, label }): Command => ({
    id: `insert.image-wrap-${value.toLowerCase()}`,
    label,
    group: 'insert',
    keywords: ['image', 'wrap', 'float', 'text flow'],
    run: ({ editor }) => {
      editor.chain().focus().updateAttributes('image', { wrap: value }).run()
    },
    isActive: ({ editor }) => editor.getAttributes('image')['wrap'] === value,
    isEnabled: ({ editor }) => editor.isActive('image'),
  })),
  {
    id: 'insert.image-alt',
    label: 'Image Alt Text…',
    group: 'insert',
    keywords: ['description', 'accessibility'],
    run: () => {
      requestPicker('image-alt')
    },
    isEnabled: ({ editor }) => editor.isActive('image'),
  },
]
