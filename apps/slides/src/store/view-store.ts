import { create } from 'zustand'

export type Theme = 'dark' | 'light' | 'system'

/** One slide a page, one with its notes, or several on paper. */
export type PrintLayout = 'slides' | 'notes' | 'handout-2' | 'handout-3' | 'handout-6'

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
  /**
   * Whether the speaker notes are open for editing.
   *
   * Here rather than inside the panel so that one command can end any text
   * edit: two ways out of a text box is one too many, and the one that is not
   * wired up is the one that silently loses what was typed.
   */
  editingNotes: boolean
  /**
   * How large the slide is drawn, as a multiple — or null to fit the window.
   *
   * Fitting is the default because a slide has a fixed shape and the useful
   * thing is almost always to see all of it.
   */
  zoom: number | null
  /**
   * The sections folded shut in the filmstrip, by section id.
   *
   * A view concern rather than a document one: what is folded is not something
   * the file records, and two windows on the same deck can disagree about it.
   */
  collapsedSections: string[]
  /** The section whose name is being typed, or null. */
  renamingSection: string | null
  /**
   * Which text the outline has open, or null.
   *
   * Its own flag rather than the deck store's `editing`, because the canvas
   * would otherwise open an editor on the same shape at the same time: two
   * ProseMirror views over one text body, both of which would commit.
   */
  editingOutline: { slide: number; shape: number } | null
  /**
   * How the deck is laid out when it goes to paper or to a PDF.
   *
   * View state rather than document state: what somebody prints today says
   * nothing about the deck, and two people printing the same file want
   * different things from it.
   */
  printLayout: PrintLayout
  /** Whether the rulers and the guides dragged out of them are showing. */
  rulers: boolean
  /** Whether the left pane shows the slides or the words on them. */
  leftPane: 'filmstrip' | 'outline'
  /**
   * What happens to the content when the deck changes shape.
   *
   * Remembered rather than asked each time: PowerPoint puts the question in a
   * dialog, and the answer is almost always the same one for a given person.
   */
  contentFit: 'maximize' | 'fit'
  panels: Panels
  /** Widths and heights in pixels, so a drag can be written straight back. */
  sizes: { filmstrip: number; properties: number; notes: number }
  setTheme: (theme: Theme) => void
  setFinding: (finding: boolean) => void
  setEditingNotes: (editing: boolean) => void
  setZoom: (zoom: number | null) => void
  toggleSection: (id: string) => void
  setRenamingSection: (id: string | null) => void
  setEditingOutline: (at: { slide: number; shape: number } | null) => void
  setRulers: (showing: boolean) => void
  setPrintLayout: (layout: PrintLayout) => void
  setLeftPane: (pane: 'filmstrip' | 'outline') => void
  setContentFit: (fit: 'maximize' | 'fit') => void
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
  editingNotes: false,
  zoom: null,
  collapsedSections: [],
  renamingSection: null,
  editingOutline: null,
  rulers: false,
  printLayout: 'slides',
  leftPane: 'filmstrip',
  contentFit: 'fit',
  panels: { filmstrip: true, properties: true, notes: true },
  sizes: DEFAULT_SIZES,

  toggleSection: (id) => {
    set((state) => ({
      collapsedSections: state.collapsedSections.includes(id)
        ? state.collapsedSections.filter((one) => one !== id)
        : [...state.collapsedSections, id],
    }))
  },

  setRenamingSection: (id) => {
    set({ renamingSection: id })
  },

  setEditingOutline: (at) => {
    set({ editingOutline: at })
  },

  setRulers: (showing) => {
    set({ rulers: showing })
  },

  setPrintLayout: (layout) => {
    set({ printLayout: layout })
  },

  setLeftPane: (pane) => {
    set({ leftPane: pane })
  },

  setContentFit: (fit) => {
    set({ contentFit: fit })
  },

  setTheme: (theme) => {
    set({ theme })
  },

  setFinding: (finding) => {
    set({ finding })
  },

  setEditingNotes: (editing) => {
    set({ editingNotes: editing })
  },

  setZoom: (zoom) => {
    // PowerPoint's own range; beyond it the slide is either unreadable or so
    // large that scrolling is the only thing left to do.
    set({ zoom: zoom === null ? null : Math.min(Math.max(zoom, 0.25), 4) })
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
