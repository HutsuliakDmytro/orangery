import { invoke } from '@tauri-apps/api/core'
import {
  buildThemeFile,
  createDeck,
  layoutOf,
  masterOf,
  saveDeck,
} from '@orangery/ooxml-presentation'
import { isTauri } from '@orangery/platform'
import { writePackage } from '@orangery/ooxml-core'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'
import { exportVideo } from './export-video'
import { noteRecent } from '../store/recent-store'
import { compressIfAsked } from './pictures-offer'
import { buildTemplate, templateById } from './templates'
import {
  nameOf,
  pickDeckPath,
  pickExportPath,
  pickSavePath,
  readDeckFile,
  writeDeckFile,
  writeFileBytes,
} from './file'
import { deckFromOdp } from './converters/odp-import'
import { readOdp } from './converters/odp-read'
import { writeOdp } from './converters/odp-write'
import { useImportStore } from './import-note'

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
  useImportStore.getState().set(null)
  await useDeckStore.getState().load(await createDeck(), null)
  document.title = 'Untitled Presentation — Orangery Slides'
}

export async function openDeck(path?: string): Promise<void> {
  // No path given means the person is choosing one; a path given means the OS
  // or the recent list already did.
  const target = path ?? (await pickDeckPath())
  if (target === null) return

  if (/\.odp$/iu.test(target)) return openOdp(target)

  useImportStore.getState().set(null)
  await useDeckStore.getState().load(await readDeckFile(target), target)

  // Only a deck that actually opened is worth offering again. A file that threw
  // — moved, or not a deck at all — would otherwise sit at the top of the list.
  if (useDeckStore.getState().open?.path !== target) return

  document.title = `${nameOf(target)} — Orangery Slides`
  await noteRecent(target)
}

/**
 * An OpenDocument presentation, converted on the way in.
 *
 * The deck it becomes belongs to no file. Writing our conversion back over
 * somebody's `.odp` would replace a document we only partly understood with
 * one we only partly wrote, and the first time that mattered it would have
 * eaten a deck. Saving asks where, and offers a `.pptx`.
 */
async function openOdp(path: string): Promise<void> {
  const imported = await deckFromOdp(await readOdp(await readDeckFile(path)))

  await useDeckStore.getState().load(imported.bytes, null)
  document.title = `${nameOf(path)} — Orangery Slides`

  useImportStore
    .getState()
    .set(
      imported.skipped === 0
        ? `${nameOf(path)} was converted from OpenDocument. Saving will write a .pptx.`
        : `${nameOf(path)} was converted from OpenDocument; ${String(imported.skipped)} ${imported.skipped === 1 ? 'item' : 'items'} could not be brought across. Saving will write a .pptx.`,
    )
}

/** Writes the deck out as an OpenDocument presentation, for somebody who asked. */
export async function exportOdp(): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  const suggested = nameOf(open.path ?? 'Presentation.pptx').replace(/\.[^.]+$/u, '.odp')
  const path = await pickExportPath(suggested, 'odp')
  if (path === null) return

  const written = await writeOdp(open.package, open.deck)
  await writeFileBytes(path, written.bytes)
}

/**
 * The deck's own look, written out as a theme file.
 *
 * The master the slide showing is built on, not the first one: a deck with two
 * masters has two looks, and the one somebody is looking at is the one they
 * mean by "this theme".
 */
export async function exportTheme(): Promise<void> {
  const { open } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null) return

  const layout = slide === null ? null : layoutOf(open.deck, slide)
  const master =
    (layout === null ? null : masterOf(open.deck, layout)) ?? [...open.deck.masters.values()][0]
  if (master === undefined) return

  const built = buildThemeFile(open.package, open.deck, master)
  if (built === null) return

  const suggested = nameOf(open.path ?? 'Theme.pptx').replace(/\.[^.]+$/u, '.thmx')
  const path = await pickExportPath(suggested, 'thmx')
  if (path === null) return

  await writeFileBytes(path, await writePackage(built))
}

/**
 * The deck as a film, which takes as long to make as it takes to watch.
 *
 * The progress is reported through the view store so the window can say where
 * it is: a command that appears to do nothing for twenty minutes is a command
 * people press again.
 */
export async function exportVideoFile(): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  const view = useViewStore.getState()
  view.setRecordingVideo({ at: 0, of: open.deck.slides.length })

  try {
    const film = await exportVideo({
      deck: open.deck,
      themes: open.themes,
      package: open.package,
      onProgress: (at, of) => {
        useViewStore.getState().setRecordingVideo({ at, of })
      },
      cancelled: () => useViewStore.getState().recordingVideo === null,
    })

    if (film === null) return

    const suggested = nameOf(open.path ?? 'Presentation.pptx').replace(
      /\.[^.]+$/u,
      `.${film.extension}`,
    )
    const path = await pickExportPath(suggested, film.extension)
    if (path === null) return

    await writeFileBytes(path, film.bytes)
  } finally {
    useViewStore.getState().setRecordingVideo(null)
  }
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
