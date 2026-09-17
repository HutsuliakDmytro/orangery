import { create } from 'zustand'

export type Theme = 'dark' | 'light' | 'system'

/** Which of the four panels around the canvas are showing. */
export interface Panels {
  filmstrip: boolean
  properties: boolean
  notes: boolean
}

interface ViewState {
  theme: Theme
  /** Whether the find and replace strip is showing. */
  finding: boolean
  panels: Panels
  /** Widths and heights in pixels, so a drag can be written straight back. */
  sizes: { filmstrip: number; properties: number; notes: number }
  setTheme: (theme: Theme) => void
  setFinding: (finding: boolean) => void
  togglePanel: (panel: keyof Panels) => void
  resize: (panel: keyof Panels, size: number) => void
}

/** Roughly PowerPoint's proportions on a 1280-wide window. */
const DEFAULT_SIZES = { filmstrip: 200, properties: 280, notes: 120 }

const LIMITS: Record<keyof Panels, { min: number; max: number }> = {
  filmstrip: { min: 120, max: 420 },
  properties: { min: 200, max: 520 },
  notes: { min: 72, max: 400 },
}

export const useViewStore = create<ViewState>((set) => ({
  theme: 'dark',
  finding: false,
  panels: { filmstrip: true, properties: true, notes: true },
  sizes: DEFAULT_SIZES,

  setTheme: (theme) => {
    set({ theme })
  },

  setFinding: (finding) => {
    set({ finding })
  },

  togglePanel: (panel) => {
    set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } }))
  },

  resize: (panel, size) => {
    const { min, max } = LIMITS[panel]
    set((state) => ({
      sizes: { ...state.sizes, [panel]: Math.min(Math.max(size, min), max) },
    }))
  },
}))

/** `system` resolved against what the OS is currently asking for. */
export function effectiveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
