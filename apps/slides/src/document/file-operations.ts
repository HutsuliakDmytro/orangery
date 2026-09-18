import { invoke } from '@tauri-apps/api/core'
import { createDeck, saveDeck } from '@orangery/ooxml-presentation'
import { isTauri } from '@orangery/platform'
import { useDeckStore } from '../store/deck-store'
import { noteRecent } from '../store/recent-store'
import { compressIfAsked } from './pictures-offer'
import { buildTemplate, templateById } from './templates'
import { nameOf, pickDeckPath, pickSavePath, readDeckFile, writeDeckFile } from './file'

/**
 * The four things that can happen to a deck as a file.
 *
 * Kept out of the command registry so that the unsaved-changes prompt can run a
 * save and then carry on with whatever the person was doing. A command's `run`
 * returns nothing and cannot be waited for, and "save, and only then close" is
 * a sequence that has to be waited for or it is not one.
 */

/**
 * Writes the deck out, asking where when it has to.
 *
 * A deck that has never been saved has nowhere to go, so Save asks the same
 * question Save As does rather than failing quietly. Everything else about the
 * write — the temporary file, the rename, the backup — is Rust's, because a
 * webview cannot rename a file and a half-written deck is a deck nobody gets
 * back.
 */
export async function saveDeckFile(askWhere: boolean): Promise<void> {
  const { open, markSaved } = useDeckStore.getState()
  if (open === null) return

  const suggested = open.path ?? 'Presentation.pptx'
  const path = askWhere || open.path === null ? await pickSavePath(nameOf(suggested)) : open.path
  if (path === null) return

  // A deck heavy with pictures gets the offer to shed some, after the file name
  // and before anything is written: the answer can be to write nothing at all.
  if (!(await compressIfAsked(open.package, open.deck))) return

  // The package is what goes to disk, not the model: everything we never
  // understood is still in it (`docs/adr/0002-pptx-roundtrip.md`).
  await writeDeckFile(path, await saveDeck(open.package))
  markSaved(path)

  // Save As gives a deck a file it did not have, or a different one; either way
  // that file is the one to offer next time, and the old name is not.
  await noteRecent(path)
}

/**
 * Starting from nothing.
 *
 * The deck is a real `.pptx` before it reaches the editor — it is built,
 * zipped, and opened by the same path a file off disk takes. Keeping a new deck
 * in some lighter in-memory shape would mean the first save was a conversion,
 * and a conversion is where things are lost.
 */
export async function newDeck(): Promise<void> {
  await useDeckStore.getState().load(await createDeck(), null)
  document.title = 'Untitled Presentation — Orangery Slides'
}

export async function openDeck(path?: string): Promise<void> {
  // No path given means the person is choosing one; a path given means the OS
  // or the recent list already did.
  const target = path ?? (await pickDeckPath())
  if (target === null) return

  await useDeckStore.getState().load(await readDeckFile(target), target)

  // Only a deck that actually opened is worth offering again. A file that threw
  // — moved, or not a deck at all — would otherwise sit at the top of the list.
  if (useDeckStore.getState().open?.path !== target) return

  document.title = `${nameOf(target)} — Orangery Slides`
  await noteRecent(target)
}

/**
 * A new deck with a template's slides already on it.
 *
 * The same path as an empty one: built, zipped, opened. A template decides what
 * is written on the deck and nothing about what the deck is.
 */
export async function newFromTemplate(id: string): Promise<void> {
  await useDeckStore.getState().load(await buildTemplate(templateById(id)), null)
  document.title = 'Untitled Presentation — Orangery Slides'
}

/**
 * A second window, on its own deck.
 *
 * One window holds one deck, so this is the only way to have two open at once.
 * The window is a fresh webview and therefore a fresh store: nothing about the
 * deck in this one travels to it.
 */
export async function openInNewWindow(path?: string): Promise<void> {
  if (!isTauri()) return
  await invoke('open_window', { path: path ?? null })
}

export function closeDeck(): void {
  useDeckStore.getState().close()
  document.title = 'Orangery Slides'
}
