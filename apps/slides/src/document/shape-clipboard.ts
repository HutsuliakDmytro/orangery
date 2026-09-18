import {
  clipboardText,
  colorContextFor,
  copyShapes,
  createShape,
  parseClipboard,
  parseShape,
  pasteShapes,
  setShapeText,
  themeFor,
  themeSnapshot,
  writeFill,
  writeLine,
} from '@orangery/ooxml-presentation'
import { children, findDescendant, setAttribute } from '@orangery/ooxml-core'
import { insertPictureOnSlide } from './insert-picture'
import type { ClipboardShapes, PasteFormatting } from '@orangery/ooxml-presentation'
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

/**
 * The last few things copied in this window, newest first.
 *
 * A clipboard holds one thing, which is right until the moment you need the
 * one before it. This is a window's memory of its own copies and nothing more:
 * what another program copied is not ours to keep, and a list that quietly
 * recorded it would be one.
 */
const HISTORY_LIMIT = 8

export interface ClipboardEntry {
  /** What it says, in a few words, for a list a person reads. */
  label: string
  /** How many shapes are in it. */
  shapes: number
  text: string
  from: string
}

let history: ClipboardEntry[] = []

export function clipboardHistory(): readonly ClipboardEntry[] {
  return history
}

export function forgetClipboardHistory(): void {
  history = []
  lastCopied = null
  copiedFrom = null
}

/** What to call a payload in a list: its words, or how many shapes it holds. */
function labelFor(payload: ClipboardShapes): string {
  const words = clipboardText(payload).join(' ').replace(/\s+/gu, ' ').trim()

  if (words !== '') return words.length > 60 ? `${words.slice(0, 57)}…` : words
  return payload.shapes.length === 1 ? '1 shape' : `${String(payload.shapes.length)} shapes`
}

function remember(text: string, from: string): void {
  const payload = parseClipboard(text)
  if (payload === null) return

  history = [
    { label: labelFor(payload), shapes: payload.shapes.length, text, from },
    // The same thing copied twice is one entry, and the newer one is the one
    // that keeps its place.
    ...history.filter((entry) => entry.text !== text),
  ].slice(0, HISTORY_LIMIT)
}

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

  // The palette the shapes were written against travels with them, so a paste
  // that wants to keep how they looked has something to settle them against.
  const theme = themeFor(open.deck, open.themes, slide)
  const snapshot = themeSnapshot(colorContextFor(open.deck, open.themes, slide), {
    major: theme?.fonts.major ?? null,
    minor: theme?.fonts.minor ?? null,
  })

  return {
    text: JSON.stringify(copyShapes(open.package, slide.path, shapes, snapshot)),
    from: slide.path,
  }
}

export async function copySelection(): Promise<boolean> {
  const payload = selectionPayload()
  if (payload === null) return false

  await write(payload.text)
  copiedFrom = payload.from
  remember(payload.text, payload.from)
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

export interface PasteChoice {
  /**
   * Whose look the shapes arrive with.
   *
   * `destination` is the default and is what the format does on its own: a
   * theme colour stays symbolic and resolves against whichever deck it lands
   * in. `source` settles those references against the palette they were copied
   * from, so they look like where they came from.
   */
  formatting?: PasteFormatting
  /** Paste the words and none of the shapes they were in. */
  textOnly?: boolean
  /** An entry from the history rather than whatever is on the clipboard now. */
  entry?: string
}

/** Three quarters of the slide, which is where a box of words is readable. */
const TEXT_SHARE = 0.75

/**
 * A text box holding the words that were copied.
 *
 * Made rather than pasted: what "keep text only" means is that the shapes are
 * not wanted, so there is nothing to paste — only something to write down.
 */
function pasteTextOnly(payload: ClipboardShapes): void {
  const lines = clipboardText(payload).filter((line) => line !== '')
  if (lines.length === 0) return

  const { open } = useDeckStore.getState()
  if (open === null) return

  const size = open.deck.slideSize
  const width = size.width * TEXT_SHARE
  const height = size.height / 3

  const made: { id: number | null } = { id: null }
  useDeckStore.getState().edit((slide) => {
    const id = createShape(slide, {
      preset: 'rect',
      transform: {
        x: Math.round((size.width - width) / 2),
        y: Math.round((size.height - height) / 2),
        width: Math.round(width),
        height: Math.round(height),
      },
    })

    // Read back from the tree rather than from `slide.shapes`: the parsed
    // shapes are the reading this part was opened with, and the one just made
    // is not in it.
    const node = children(slide.tree).at(-1)
    const shape = node === undefined ? undefined : parseShape(node)
    if (shape === undefined || shape.id !== id) return false

    // A box of words is not a rectangle that happens to hold some: without the
    // fill and the line gone it arrives as a filled block, and without the flag
    // PowerPoint offers it a shape's handles rather than a text box's.
    writeFill(shape, { kind: 'none' })
    writeLine(shape, { fill: { kind: 'none' } })
    const marker = findDescendant(shape.node, 'p:cNvSpPr')
    if (marker !== undefined) setAttribute(marker, 'txBox', '1')

    setShapeText(
      shape,
      lines.map((text) => ({ text })),
    )
    made.id = id
    return true
  })

  if (made.id !== null) useDeckStore.getState().selectShapes([made.id])
}

export async function pasteShapesHere(choice: PasteChoice = {}): Promise<void> {
  const held = choice.entry ?? null
  const payload = held === null ? await read() : parseClipboard(held)
  const { open } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null) return

  if (payload === null) {
    const picture = await pastedPicture()
    if (picture !== null) insertPictureOnSlide(picture.name, picture.bytes)
    return
  }

  if (choice.textOnly === true) {
    pasteTextOnly(payload)
    return
  }

  // Onto the slide they came from, they would land exactly on the originals and
  // look like nothing happened; anywhere else there is nothing to be confused
  // with, and the position they were copied at is the position they want.
  const from = held === null ? copiedFrom : (history.find((one) => one.text === held)?.from ?? null)
  const offset = from === slide.path ? { x: NUDGE, y: NUDGE } : { x: 0, y: 0 }

  const pasted: number[] = []
  useDeckStore.getState().edit((edited) => {
    pasted.push(
      ...pasteShapes(open.package, edited, payload, {
        offset,
        formatting: choice.formatting ?? 'destination',
      }),
    )
    return pasted.length > 0
  })

  // What was pasted is what you are about to move, so it is what is selected.
  if (pasted.length > 0) useDeckStore.getState().selectShapes(pasted)
}
