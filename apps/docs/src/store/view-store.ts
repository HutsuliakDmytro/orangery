import { create } from 'zustand'
import { DEFAULT_SECTION } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import type { HeadingNumberScheme } from '../editor/heading-numbers'

/**
 * View state: zoom, page setup and which panels are open.
 *
 * Separate from `documentStore` because none of it is part of the document —
 * changing the zoom must not mark the file dirty. Page setup is the exception:
 * it *is* part of the document, so it is applied through a callback that marks
 * the document changed.
 */

export const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2] as const

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2

export interface ViewState {
  zoom: number
  section: SectionProperties
  /**
   * Which scheme numbers the headings, or null when they are not numbered.
   *
   * A property of the document rather than of the app: it is written into the
   * file as a numbering definition attached to the heading styles.
   */
  headingNumbering: HeadingNumberScheme | null
  /**
   * Whether edits are recorded as tracked changes.
   *
   * A property of the document — Word keeps it in `settings.xml` — rather than
   * of the app: a reviewer turns it on for the document they were sent.
   */
  trackChanges: boolean
  outlineOpen: boolean

  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setSection: (section: SectionProperties) => void
  setHeadingNumbering: (scheme: HeadingNumberScheme | null) => void
  setTrackChanges: (on: boolean) => void
  toggleOutline: () => void
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

/** Steps through the preset ladder rather than by a fixed amount, like Docs. */
export function steppedZoom(current: number, direction: 1 | -1): number {
  const ladder = [...ZOOM_LEVELS]
  if (direction === 1) return ladder.find((level) => level > current) ?? MAX_ZOOM
  return [...ladder].reverse().find((level) => level < current) ?? MIN_ZOOM
}

export const useViewStore = create<ViewState>((set) => ({
  zoom: 1,
  section: { ...DEFAULT_SECTION, margins: { ...DEFAULT_SECTION.margins } },
  headingNumbering: null,
  trackChanges: false,
  outlineOpen: false,

  setZoom: (zoom) => {
    set({ zoom: clampZoom(zoom) })
  },
  zoomIn: () => {
    set((state) => ({ zoom: steppedZoom(state.zoom, 1) }))
  },
  zoomOut: () => {
    set((state) => ({ zoom: steppedZoom(state.zoom, -1) }))
  },
  resetZoom: () => {
    set({ zoom: 1 })
  },
  setHeadingNumbering: (scheme) => {
    set({ headingNumbering: scheme })
  },

  setTrackChanges: (on) => {
    set({ trackChanges: on })
  },

  setSection: (section) => {
    set({ section })
  },
  toggleOutline: () => {
    set((state) => ({ outlineOpen: !state.outlineOpen }))
  },
}))
