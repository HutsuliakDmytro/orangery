import { create } from 'zustand'
import { baseName } from '@orangery/platform'
import { useDeckStore } from '../store/deck-store'
import { clearSnapshot, documentKey } from './autosave'
import { saveDeckFile } from './file-operations'

/**
 * Nothing is lost without being asked.
 *
 * Four things can take a deck off the screen — New, Open, Close, and the window
 * itself — and each of them would otherwise throw away whatever had not been
 * saved. They all go through here, so there is one question with one wording
 * and one set of answers, rather than four places that must each remember to
 * ask.
 *
 * The autosave snapshot is not a substitute for asking. It is there for the
 * crash nobody chose; this is the close somebody did.
 */

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** What to do once the unsaved work has been dealt with. */
type PendingAction = () => void | Promise<void>

interface GuardState {
  /** Set while the prompt is up; null when there is nothing to answer. */
  pending: PendingAction | null
  ask: (action: PendingAction) => void
  clear: () => void
}

export const useGuardStore = create<GuardState>((set) => ({
  pending: null,
  ask: (action) => {
    set({ pending: action })
  },
  clear: () => {
    set({ pending: null })
  },
}))

/**
 * Runs `action`, asking about unsaved work first when there is any.
 *
 * A clean deck goes straight through. Prompting every time is the behaviour
 * people learn to click past without reading, which makes the prompt useless
 * on the one occasion it mattered.
 */
export function whenSafe(action: PendingAction): void {
  const { open, saved } = useDeckStore.getState()
  if (open === null || saved) {
    void action()
    return
  }

  useGuardStore.getState().ask(action)
}

export async function resolveUnsaved(choice: UnsavedChoice): Promise<void> {
  const action = useGuardStore.getState().pending
  useGuardStore.getState().clear()

  if (action === null || choice === 'cancel') return

  if (choice === 'save') {
    await saveDeckFile(false)
    // Only carry on if the save actually landed. A cancelled Save As dialog
    // leaves the deck exactly as unsaved as it was, and going ahead then would
    // throw away the work the person had just asked to keep.
    if (!useDeckStore.getState().saved) return
    await action()
    return
  }

  // The person chose to throw this work away. Leaving the snapshot behind would
  // offer it back at the next launch as work that was never lost, which is the
  // opposite of what they just said.
  await clearSnapshot(await documentKey(useDeckStore.getState().sessionId))
  await action()
}

/** What the prompt calls the deck it is asking about. */
export function unsavedDeckName(): string {
  const path = useDeckStore.getState().open?.path ?? null
  return path === null ? 'Untitled Presentation' : baseName(path)
}
