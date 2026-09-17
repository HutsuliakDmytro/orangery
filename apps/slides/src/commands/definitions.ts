import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import { nameOf, pickDeckPath, readDeckFile } from '../document/file'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * What Slides can do so far.
 *
 * The registry is the single source of actions: whatever is here appears in the
 * native menu and the command palette without either being told separately
 * (`apps/docs/docs/adr/0002-command-registry.md`).
 *
 * A command that is not implemented yet is registered disabled rather than left
 * out. The menu is the shape of the application: a File menu with nothing in it
 * says the app cannot open a deck at all, while a greyed-out Save says it
 * cannot do so yet.
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
  {
    id: 'file.open',
    label: 'Open…',
    group: 'file',
    shortcut: 'Mod+o',
    // Nothing to pick a file with outside the app shell, so the browser build
    // shows the command greyed out rather than failing when it is used.
    isEnabled: () => isTauri(),
    run: () => {
      void openDeck()
    },
  },
  {
    id: 'file.close',
    label: 'Close Presentation',
    group: 'file',
    shortcut: 'Mod+w',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useDeckStore.getState().close()
    },
  },
  notYet('file.new', 'New Presentation', 'Mod+n'),
  notYet('file.save', 'Save', 'Mod+s'),
]

async function openDeck(): Promise<void> {
  const path = await pickDeckPath()
  if (path === null) return

  await useDeckStore.getState().load(await readDeckFile(path), path)
  document.title = `${nameOf(path)} — Orangery Slides`
}

export const slideCommands: readonly Command[] = [
  {
    id: 'view.next-slide',
    label: 'Next Slide',
    group: 'view',
    shortcut: 'PageDown',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { current, select } = useDeckStore.getState()
      select(current + 1)
    },
  },
  {
    id: 'view.previous-slide',
    label: 'Previous Slide',
    group: 'view',
    shortcut: 'PageUp',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { current, select } = useDeckStore.getState()
      select(current - 1)
    },
  },
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
  registerAll(slideCommands)
  registerAll(viewCommands)
  registerAll(appearanceCommands)
}
