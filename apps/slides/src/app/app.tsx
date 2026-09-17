import { useRef } from 'react'
import { CommandPalette, CommandSourceProvider, useNativeMenu } from '@orangery/ui-kit'
import { Canvas } from '../components/canvas'
import { Filmstrip } from '../components/filmstrip'
import { FindPanel } from '../components/find-panel'
import { Notes } from '../components/notes'
import { PropertiesPanel } from '../components/properties-panel'
import { ResizeHandle } from '../components/resize-handle'
import { WarningsBanner } from '../components/warnings-banner'
import { registerBuiltinCommands } from '../commands/definitions'
import { useDeckStore } from '../store/deck-store'
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

  const open = useDeckStore((state) => state.open)
  const current = useDeckStore((state) => state.current)
  const finding = useViewStore((state) => state.finding)
  const setFinding = useViewStore((state) => state.setFinding)
  const panels = useViewStore((state) => state.panels)
  const sizes = useViewStore((state) => state.sizes)
  const resize = useViewStore((state) => state.resize)
  const middle = useRef<HTMLDivElement>(null)

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">{title(open?.path ?? null)}</span>
        {open !== null && (
          <span className="text-xs text-muted">
            Slide {current + 1} of {open.deck.slides.length}
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

      <WarningsBanner />

      <div className="flex min-h-0 flex-1">
        {panels.filmstrip && (
          <>
            <aside
              aria-label="Slides"
              style={{ width: sizes.filmstrip }}
              className="shrink-0 overflow-y-auto bg-surface"
            >
              <Filmstrip />
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

      <CommandPalette />
    </div>
  )
}

/** What the window is called: the file, or the app when there is none. */
function title(path: string | null): string {
  return path === null ? 'Orangery Slides' : (path.split(/[\\/]/u).pop() ?? path)
}

export function App() {
  const source = useCommandSource()

  return (
    <CommandSourceProvider source={source}>
      <Shell />
    </CommandSourceProvider>
  )
}
