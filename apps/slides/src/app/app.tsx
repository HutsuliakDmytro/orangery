import { useRef } from 'react'
import { CommandPalette, CommandSourceProvider, useNativeMenu } from '@orangery/ui-kit'
import { ResizeHandle } from '../components/resize-handle'
import { WelcomeScreen } from '../components/welcome-screen'
import { registerBuiltinCommands } from '../commands/definitions'
import { useViewStore } from '../store/view-store'
import { useCommandSource } from './command-source'
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

  const panels = useViewStore((state) => state.panels)
  const sizes = useViewStore((state) => state.sizes)
  const resize = useViewStore((state) => state.resize)
  const middle = useRef<HTMLDivElement>(null)

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">Untitled presentation</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {panels.filmstrip && (
          <>
            <aside
              aria-label="Slides"
              style={{ width: sizes.filmstrip }}
              className="shrink-0 overflow-y-auto bg-surface p-2 text-xs text-muted"
            >
              No slides yet
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
            <WelcomeScreen />
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
                className="shrink-0 overflow-y-auto bg-surface p-3 text-xs text-muted"
              >
                Notes appear here
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
              Nothing selected
            </aside>
          </>
        )}
      </div>

      <CommandPalette />
    </div>
  )
}

export function App() {
  const source = useCommandSource()

  return (
    <CommandSourceProvider source={source}>
      <Shell />
    </CommandSourceProvider>
  )
}
