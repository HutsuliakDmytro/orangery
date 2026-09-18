import { copyShapes, parseClipboard, pasteShapes } from '@orangery/ooxml-presentation'
import { insertPictureOnSlide } from './insert-picture'
import type { ClipboardShapes } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * Copying shapes, including into another window.
 *
 * Through the system clipboard rather than a variable in this window, because
 * "between decks" means between two windows, and each window is its own webview
 * with its own everything. The payload is text because a clipboard carries
 * text; that it happens to be JSON with XML inside is nobody else's business,
 * and anything that is not ours is left for the browser to handle.
 *
 * A copy of the last payload is kept beside it so that a paste still works
 * where the clipboard cannot be read at all — a browser that refuses
 * permission. It is a fallback for that and for nothing else: a clipboard that
 * reads back somebody else's text means they copied somebody else's text, and
 * answering with what we held before that would paste our memory over their
 * intention.
 */

let lastCopied: string | null = null

/** The slide the clipboard's shapes were taken from, if it was this window. */
let copiedFrom: string | null = null

/** A quarter inch, which is what PowerPoint moves a paste by. */
const NUDGE = 228600

async function write(text: string): Promise<void> {
  lastCopied = text
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // No permission, or no clipboard at all. The fallback above still holds it,
    // so pasting in this window works and pasting in another does not — which
    // is better than the copy appearing to fail.
  }
}

async function read(): Promise<ClipboardShapes | null> {
  try {
    // Read and not ours is an answer, not a failure: the person copied
    // something else, and pasting what we held before that would be pasting
    // over their intention with our memory.
    return parseClipboard(await navigator.clipboard.readText())
  } catch {
    // Could not be read at all — no permission, or no clipboard. Only then is
    // what this window last copied the best answer available.
    return lastCopied === null ? null : parseClipboard(lastCopied)
  }
}

/** What the clipboard would be given for the current selection, or null. */
function selectionPayload(): { text: string; from: string } | null {
  const { open, selection } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null || selection.length === 0) return null

  const shapes = slide.shapes.filter((shape) => selection.includes(shape.id))
  if (shapes.length === 0) return null

  return { text: JSON.stringify(copyShapes(open.package, slide.path, shapes)), from: slide.path }
}

export async function copySelection(): Promise<boolean> {
  const payload = selectionPayload()
  if (payload === null) return false

  await write(payload.text)
  copiedFrom = payload.from
  return true
}

/**
 * A picture from the clipboard, if that is what is on it.
 *
 * Tried after our own shapes and before giving up: a screenshot is the most
 * common thing anybody pastes onto a slide, and until now it was the one thing
 * paste could not do.
 */
async function pastedPicture(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (typeof navigator.clipboard.read !== 'function') return null

  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((one) => one.startsWith('image/'))
      if (type === undefined) continue

      const blob = await item.getType(type)
      const extension = type.slice('image/'.length).replace('jpeg', 'jpg')
      return { name: `pasted.${extension}`, bytes: new Uint8Array(await blob.arrayBuffer()) }
    }
  } catch {
    // No permission, or nothing readable. Not an error: there was simply no
    // picture to be had.
  }

  return null
}

export async function pasteShapesHere(): Promise<void> {
  const payload = await read()
  const { open } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null) return

  if (payload === null) {
    const picture = await pastedPicture()
    if (picture !== null) insertPictureOnSlide(picture.name, picture.bytes)
    return
  }

  // Onto the slide they came from, they would land exactly on the originals and
  // look like nothing happened; anywhere else there is nothing to be confused
  // with, and the position they were copied at is the position they want.
  const offset = copiedFrom === slide.path ? { x: NUDGE, y: NUDGE } : { x: 0, y: 0 }

  const pasted: number[] = []
  useDeckStore.getState().edit((edited) => {
    pasted.push(...pasteShapes(open.package, edited, payload, { offset }))
    return pasted.length > 0
  })

  // What was pasted is what you are about to move, so it is what is selected.
  if (pasted.length > 0) useDeckStore.getState().selectShapes(pasted)
}
