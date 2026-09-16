import { printDocument } from '../../../document/print'
import { useViewStore } from '../../../store/view-store'
import { requestPicker } from '../picker-store'
import type { Command } from '../types'

/**
 * View commands. These change how the document is shown, not the document —
 * so none of them mark it dirty.
 */
export const viewCommands: readonly Command[] = [
  {
    id: 'view.zoom-in',
    label: 'Zoom In',
    group: 'view',
    shortcut: 'Mod+=',
    keywords: ['bigger', 'magnify'],
    run: () => {
      useViewStore.getState().zoomIn()
    },
    isEnabled: () => useViewStore.getState().zoom < 2,
  },
  {
    id: 'view.zoom-out',
    label: 'Zoom Out',
    group: 'view',
    shortcut: 'Mod+-',
    keywords: ['smaller', 'reduce'],
    run: () => {
      useViewStore.getState().zoomOut()
    },
    isEnabled: () => useViewStore.getState().zoom > 0.5,
  },
  {
    id: 'view.zoom-reset',
    label: 'Actual Size',
    group: 'view',
    shortcut: 'Mod+0',
    keywords: ['100%', 'reset zoom'],
    run: () => {
      useViewStore.getState().resetZoom()
    },
  },
  {
    id: 'view.outline',
    label: 'Document Outline',
    group: 'view',
    shortcut: 'Mod+Alt+a',
    keywords: ['headings', 'navigation', 'sidebar'],
    run: () => {
      useViewStore.getState().toggleOutline()
    },
    isActive: () => useViewStore.getState().outlineOpen,
  },
  {
    id: 'file.page-setup',
    label: 'Page Setup…',
    group: 'file',
    keywords: ['margins', 'orientation', 'paper', 'size'],
    run: () => {
      requestPicker('page-setup')
    },
  },
  {
    id: 'file.print',
    label: 'Print…',
    group: 'file',
    shortcut: 'Mod+p',
    keywords: ['pdf', 'export pdf', 'paper'],
    run: () => {
      // The system dialog offers "Save as PDF" on macOS, which is the export
      // path too: a separate renderer would disagree with the preview.
      printDocument(useViewStore.getState().section)
    },
  },
  {
    id: 'view.settings',
    label: 'Settings…',
    group: 'view',
    keywords: ['preferences', 'options', 'theme', 'language'],
    run: () => {
      requestPicker('settings')
    },
  },
]
