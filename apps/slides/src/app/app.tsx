import { useRef } from 'react'
import {
  CommandPalette,
  CommandSourceProvider,
  ConfirmDialog,
  useNativeMenu,
} from '@orangery/ui-kit'
import { Canvas } from '../components/canvas'
import { Filmstrip } from '../components/filmstrip'
import { Outline } from '../components/outline'
import { MasterList } from '../components/master-list'
import { FindPanel } from '../components/find-panel'
import { Notes } from '../components/notes'
import { PropertiesPanel } from '../components/properties-panel'
import { ResizeHandle } from '../components/resize-handle'
import { PrintView } from '../components/print-view'
import { RecentDecks } from '../components/recent-decks'
import { PicturesDialog } from '../components/pictures-dialog'
import { ShapeGallery } from '../components/shape-gallery'
import { TablePicker } from '../components/table-picker'
import { HeaderFooterDialog } from '../components/header-footer-dialog'
import { GridDialog } from '../components/grid-dialog'
import { PasteDialog } from '../components/paste-dialog'
import { TemplatePicker } from '../components/template-picker'
import { RecoveryBanner } from '../components/recovery-banner'
import { Show } from '../components/show'
import { WarningsBanner } from '../components/warnings-banner'
import { registerBuiltinCommands } from '../commands/definitions'
import { useAutosave } from '../document/use-autosave'
import { useCrashRecovery } from '../document/use-crash-recovery'
import { resolveUnsaved, unsavedDeckName, useGuardStore } from '../document/unsaved'
import { useCloseGuard } from './use-close-guard'
import { useExternalOpen } from './use-external-open'
import { baseName } from '@orangery/platform'
import { useDeckStore } from '../store/deck-store'
import type { OpenDeck } from '../store/deck-store'
import { useViewStore } from '../store/view-store'
import { useCommandSource } from './command-source'
import { useShortcuts } from './use-shortcuts'
import { useTheme } from './use-theme'

// Registration happens once at module load: the registry is process-wide state,
// and `registerBuiltinCommands` resets first so hot reload cannot double-register.
registerBuiltinCommands()

/**
 * The window: filmstrip on the left, canvas in the middle, format panel on the
 * right, notes underneath — PowerPoint's arrangement, which is the one people
 * already know (CLAUDE.md, "Familiar").
 *
 * There is no deck yet, so the panels are empty and the canvas shows the
 * welcome screen. The frame exists first because everything after it hangs off
 * these four regions.
 */
function Shell() {
  useTheme()
  useNativeMenu()
  useShortcuts()
  useAutosave()
  useCloseGuard()
  useExternalOpen()
  const recovery = useCrashRecovery()
  const prompting = useGuardStore((state) => state.pending) !== null

  const open = useDeckStore((state) => state.open)
  const current = useDeckStore((state) => state.current)
  const finding = useViewStore((state) => state.finding)
  const setFinding = useViewStore((state) => state.setFinding)
  const panels = useViewStore((state) => state.panels)
  const sizes = useViewStore((state) => state.sizes)
  const leftPane = useViewStore((state) => state.leftPane)
  const master = useDeckStore((state) => state.master)
  const saved = useDeckStore((state) => state.saved)

  const paneLabel = master !== null ? 'Masters' : leftPane === 'outline' ? 'Outline' : 'Slides'
  const resize = useViewStore((state) => state.resize)
  const middle = useRef<HTMLDivElement>(null)

  return (
    <div className="orangery-print-root flex h-full flex-col bg-bg text-text">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">
          {title(open, open?.path ?? null)}
          {/* The dot every editor uses, rather than the word: it says the same
              thing in the space a title bar has. */}
          {open !== null && !saved && <span aria-label="Unsaved changes"> •</span>}
        </span>
        <RecentDecks />

        {open !== null && (
          <span className="text-xs text-muted">
            {master === null ? (
              <>
                Slide {current + 1} of {open.deck.slides.length}
              </>
            ) : (
              'Slide Master'
            )}
          </span>
        )}
      </header>

      {finding && (
        <FindPanel
          onClose={() => {
            setFinding(false)
          }}
        />
      )}

      <RecoveryBanner
        candidates={recovery.candidates}
        onRecover={recovery.recover}
        onDiscard={recovery.discard}
        onDiscardAll={recovery.discardAll}
      />

      <TemplatePicker />

      <ShapeGallery />

      <TablePicker />

      <HeaderFooterDialog />

      <GridDialog />

      <PasteDialog />

      <PicturesDialog />

      <PrintView />

      <Show />

      <WarningsBanner />

      <div className="flex min-h-0 flex-1">
        {panels.filmstrip && (
          <>
            <aside
              aria-label={paneLabel}
              style={{ width: sizes.filmstrip }}
              className="shrink-0 overflow-y-auto bg-surface"
            >
              {master !== null ? (
                <MasterList />
              ) : leftPane === 'outline' ? (
                <Outline />
              ) : (
                <Filmstrip />
              )}
            </aside>
            <ResizeHandle
              orientation="vertical"
              label="Resize the slide panel"
              onResize={(x) => {
                resize('filmstrip', x)
              }}
            />
          </>
        )}

        <div ref={middle} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 bg-surface-2">
            <Canvas />
          </main>

          {panels.notes && (
            <>
              <ResizeHandle
                orientation="horizontal"
                label="Resize the notes panel"
                onResize={(y) => {
                  const bounds = middle.current?.getBoundingClientRect()
                  if (bounds) resize('notes', bounds.bottom - y)
                }}
              />
              <section
                aria-label="Speaker notes"
                style={{ height: sizes.notes }}
                className="shrink-0 overflow-y-auto bg-surface p-3"
              >
                <Notes />
              </section>
            </>
          )}
        </div>

        {panels.properties && (
          <>
            <ResizeHandle
              orientation="vertical"
              label="Resize the format panel"
              onResize={(x) => {
                resize('properties', window.innerWidth - x)
              }}
            />
            <aside
              aria-label="Format"
              style={{ width: sizes.properties }}
              className="shrink-0 overflow-y-auto bg-surface p-3 text-xs text-muted"
            >
              <PropertiesPanel />
            </aside>
          </>
        )}
      </div>

      {prompting && (
        <ConfirmDialog
          title="Unsaved changes"
          message={`Do you want to save the changes you made to ${unsavedDeckName()}? Your changes will be lost if you don't save them.`}
          onCancel={() => {
            void resolveUnsaved('cancel')
          }}
          choices={[
            {
              label: "Don't Save",
              danger: true,
              onChoose: () => {
                void resolveUnsaved('discard')
              },
            },
            {
              label: 'Cancel',
              onChoose: () => {
                void resolveUnsaved('cancel')
              },
            },
            {
              label: 'Save',
              primary: true,
              onChoose: () => {
                void resolveUnsaved('save')
              },
            },
          ]}
        />
      )}

      <CommandPalette />
    </div>
  )
}

/**
 * What the window is called: the file, or what there is instead of one.
 *
 * A deck with no path is not the same as no deck. Saying "Orangery Slides" for
 * both would leave a new presentation looking like an empty window, and the dot
 * beside it claiming unsaved changes to nothing.
 */
function title(open: OpenDeck | null, path: string | null): string {
  if (path !== null) return baseName(path)
  return open === null ? 'Orangery Slides' : 'Untitled Presentation'
}

export function App() {
  const source = useCommandSource()

  return (
    <CommandSourceProvider source={source}>
      <Shell />
    </CommandSourceProvider>
  )
}
