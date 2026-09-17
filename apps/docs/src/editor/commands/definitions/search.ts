import { requestPicker } from '../picker-store'
import type { Command } from '@orangery/ui-kit'

export const searchCommandDefinitions: readonly Command[] = [
  {
    id: 'edit.find',
    label: 'Find…',
    group: 'edit',
    shortcut: 'Mod+f',
    keywords: ['search', 'locate'],
    run: () => {
      requestPicker('find-replace')
    },
  },
  {
    id: 'edit.replace',
    label: 'Find and Replace…',
    group: 'edit',
    shortcut: 'Mod+h',
    keywords: ['substitute', 'swap'],
    run: () => {
      requestPicker('find-replace')
    },
  },
  {
    id: 'edit.find-next',
    label: 'Find Next',
    group: 'edit',
    shortcut: 'Mod+g',
    run: ({ editor }) => {
      editor.commands.findNext()
    },
  },
  {
    id: 'edit.find-previous',
    label: 'Find Previous',
    group: 'edit',
    shortcut: 'Mod+Shift+g',
    run: ({ editor }) => {
      editor.commands.findPrevious()
    },
  },
  {
    id: 'edit.paste-plain',
    label: 'Paste Without Formatting',
    group: 'edit',
    shortcut: 'Mod+Shift+v',
    keywords: ['plain text', 'unformatted'],
    run: ({ editor }) => {
      editor.commands.armPlainTextPaste()
    },
  },
]
