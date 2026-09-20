import { useEffect, useState } from 'react'
import { CommandPalette, CommandSourceProvider, useNativeMenu } from '@orangery/ui-kit'
import { baseName } from '@orangery/platform'
import { selectedCount } from '@orangery/grid'
import { registerBuiltinCommands } from '../commands/definitions'
import { openWorkbookFromDialog } from '../document/file'
import { ReferenceBox } from '../render/reference-box'
import { SheetView } from '../render/sheet-view'
import { useWorkbookStore, visibleSheetsOf } from '../store/workbook-store'
import { useCommandSource } from './command-source'
import { useExternalOpen } from './use-external-open'
import { useShortcuts } from './use-shortcuts'

// Registration happens once at module load: the registry is process-wide state,
// and `registerBuiltinCommands` resets first so hot reload cannot double-register.
registerBuiltinCommands()

/**
 * The window.
 *
 * A spreadsheet is one big surface and a strip of tabs, and almost everything a
 * person does happens on the surface. Around it, so far, is the one thing a
 * surface cannot say for itself: which cell the cursor is on when four hundred
 * are selected. The toolbar and the formula bar come with editing.
 */
function Shell() {
  useNativeMenu()
  useShortcuts()
  useExternalOpen()

  const open = useWorkbookStore((state) => state.open)
  const path = useWorkbookStore((state) => state.path)
  const current = useWorkbookStore((state) => state.current)
  const problem = useWorkbookStore((state) => state.problem)
  const dismiss = useWorkbookStore((state) => state.dismiss)
  const select = useWorkbookStore((state) => state.select)
  const selection = useWorkbookStore((state) => state.selection)
  const choose = useWorkbookStore((state) => state.choose)
  const edit = useWorkbookStore((state) => state.edit)
  const clear = useWorkbookStore((state) => state.clear)
  const size = useWindowSize()

  useEffect(() => {
    document.title = path === null ? 'Orangery Sheets' : baseName(path)
  }, [path])

  const sheets = open === null ? [] : visibleSheetsOf(open)
  const sheet = sheets[current] ?? null
  const tabsHeight = sheets.length > 0 ? 32 : 0
  const barHeight = sheet === null ? 0 : 33
  const selected = selectedCount(selection)

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {problem !== null && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-xs"
        >
          <span>{problem}</span>
          <button type="button" onClick={dismiss} className="text-muted hover:text-text">
            Dismiss
          </button>
        </div>
      )}

      {sheet !== null && (
        <div className="flex h-8 items-center gap-3 border-b border-border px-2">
          <ReferenceBox
            selection={selection}
            extent={{ rows: 1_048_576, columns: 16_384 }}
            onGo={choose}
          />
          {selected > 1 && (
            <span className="text-xs text-muted">{`${String(selected)} cells`}</span>
          )}
        </div>
      )}

      <main className="min-h-0 flex-1">
        {sheet === null || open === null ? (
          <Welcome />
        ) : (
          <SheetView
            open={open}
            sheet={sheet}
            width={size.width}
            height={Math.max(
              size.height - tabsHeight - barHeight - (problem === null ? 0 : 34),
              120,
            )}
            selection={selection}
            onSelectionChange={choose}
            onEdit={edit}
            onClear={clear}
          />
        )}
      </main>

      {sheets.length > 0 && (
        <nav aria-label="Sheets" className="flex h-8 items-stretch gap-px border-t border-border">
          {sheets.map((one, index) => (
            <button
              key={one.path}
              type="button"
              aria-current={index === current}
              onClick={() => {
                select(index)
              }}
              className={`px-3 text-xs ${
                index === current
                  ? 'border-b-2 border-accent text-text'
                  : 'text-muted hover:text-text'
              }`}
            >
              {one.name}
            </button>
          ))}
        </nav>
      )}

      <CommandPalette />
    </div>
  )
}

/**
 * What there is instead of a workbook.
 *
 * One button, because there is one thing to do: a spreadsheet nobody has
 * opened a file into has nothing to show, and a window of empty cells would be
 * a new workbook, which is a different promise from the one this can keep yet.
 */
function Welcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
      <p>No workbook open</p>
      <button
        type="button"
        onClick={() => {
          void openWorkbookFromDialog()
        }}
        className="rounded border border-border px-3 py-1 text-text hover:border-accent"
      >
        Open a workbook…
      </button>
    </div>
  )
}

export function App() {
  return (
    <CommandSourceProvider source={useCommandSource()}>
      <Shell />
    </CommandSourceProvider>
  )
}

/**
 * The window's size, which the grid needs in numbers.
 *
 * A canvas cannot be told to fill its parent — it has to be given a width and a
 * height in pixels — so the one thing the shell measures is the window.
 */
function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    const onResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return size
}
