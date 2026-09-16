import { useSyncExternalStore } from 'react'

/**
 * Which picker a command has asked to open.
 *
 * Registry commands take no arguments (see `docs/adr/0002-command-registry.md`),
 * so a parameterised action — pick a colour, pick a font — is a command that
 * opens a picker plus the picker applying the value. This tiny store is the
 * channel between the two; it deliberately holds no document state.
 */

export type PickerKind =
  | 'text-color'
  | 'highlight'
  | 'font-family'
  | 'font-size'
  | 'line-spacing'
  | 'link'
  | 'find-replace'
  | 'page-setup'
  | 'page-numbers'
  | 'settings'
  | 'image-alt'
  | 'special-characters'
  | 'table-grid'
  | 'cell-background'
  | 'table-borders'

let openPicker: PickerKind | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function requestPicker(kind: PickerKind): void {
  openPicker = kind
  emit()
}

export function closePicker(): void {
  if (openPicker === null) return
  openPicker = null
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): PickerKind | null {
  return openPicker
}

export function useOpenPicker(): PickerKind | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Test-only: clears state between cases. */
export function resetPickers(): void {
  openPicker = null
  emit()
}
