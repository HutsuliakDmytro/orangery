import { createDeck, saveDeck } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'
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

  // The package is what goes to disk, not the model: everything we never
  // understood is still in it (`docs/adr/0002-pptx-roundtrip.md`).
  await writeDeckFile(path, await saveDeck(open.package))
  markSaved(path)
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

export async function openDeck(): Promise<void> {
  const path = await pickDeckPath()
  if (path === null) return

  await useDeckStore.getState().load(await readDeckFile(path), path)
  document.title = `${nameOf(path)} — Orangery Slides`
}

export function closeDeck(): void {
  useDeckStore.getState().close()
  document.title = 'Orangery Slides'
}
