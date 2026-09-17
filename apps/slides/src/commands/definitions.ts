import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { useViewStore } from '../store/view-store'

/**
 * What Slides can do so far.
 *
 * The registry is the single source of actions: whatever is here appears in the
 * native menu and the command palette without either being told separately
 * (`apps/docs/docs/adr/0002-command-registry.md`).
 *
 * The file commands are registered disabled rather than left out. The menu is
 * the shape of the application, and a File menu with nothing in it says the app
 * cannot open a deck at all; a greyed-out Open says it cannot do so yet. They
 * become real in phase 1, when there is a package to read.
 */

const notYet = (id: string, label: string, shortcut?: string): Command => ({
  id,
  label,
  group: 'file',
  ...(shortcut === undefined ? {} : { shortcut }),
  isEnabled: () => false,
  run: () => {
    // Deliberately nothing: `isEnabled` keeps this unreachable from every
    // surface, and a stub that half-worked would be worse than one that does not.
  },
})

export const fileCommands: readonly Command[] = [
  notYet('file.new', 'New Presentation', 'Mod+n'),
  notYet('file.open', 'Open…', 'Mod+o'),
  notYet('file.save', 'Save', 'Mod+s'),
]

export const viewCommands: readonly Command[] = [
  {
    id: 'view.filmstrip',
    label: 'Slide Panel',
    group: 'view',
    isActive: () => useViewStore.getState().panels.filmstrip,
    run: () => {
      useViewStore.getState().togglePanel('filmstrip')
    },
  },
  {
    id: 'view.properties',
    label: 'Format Panel',
    group: 'view',
    isActive: () => useViewStore.getState().panels.properties,
    run: () => {
      useViewStore.getState().togglePanel('properties')
    },
  },
  {
    id: 'view.notes',
    label: 'Notes',
    group: 'view',
    isActive: () => useViewStore.getState().panels.notes,
    run: () => {
      useViewStore.getState().togglePanel('notes')
    },
  },
]

export const appearanceCommands: readonly Command[] = (['dark', 'light', 'system'] as const).map(
  (theme) => ({
    id: `view.theme-${theme}`,
    label: `${theme.charAt(0).toUpperCase()}${theme.slice(1)} Theme`,
    group: 'view',
    isActive: () => useViewStore.getState().theme === theme,
    run: () => {
      useViewStore.getState().setTheme(theme)
    },
  }),
)

/** Registers every command exactly once; the reset keeps hot reload from double-registering. */
export function registerBuiltinCommands(): void {
  resetRegistry()
  registerAll(fileCommands)
  registerAll(viewCommands)
  registerAll(appearanceCommands)
}
