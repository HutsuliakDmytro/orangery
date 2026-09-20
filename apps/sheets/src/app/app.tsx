import { useCallback, useEffect, useState } from 'react'
import type { CellAddress } from '@orangery/grid'
import { CommandPalette, CommandSourceProvider, useNativeMenu } from '@orangery/ui-kit'
import { baseName } from '@orangery/platform'
import { selectedCount } from '@orangery/grid'
import { registerBuiltinCommands } from '../commands/definitions'
import { openWorkbookFromDialog, recoverWorkbook } from '../document/file'
import { recoverable } from '../document/autosave'
import { guessOptions, pickCsv, workbookFromCsv } from '../document/csv-file'
import type { ImportOptions } from '../document/csv-file'
import { CsvWizard } from '../render/csv-wizard'
import type { Recoverable } from '../document/autosave'
import { valuesIn } from '../document/filter'
import { FilterMenu } from '../render/filter-menu'
import { ReferenceBox } from '../render/reference-box'
import { Toolbar } from '../render/toolbar'
import { SheetView } from '../render/sheet-view'
import { useWorkbookStore, visibleSheetsOf } from '../store/workbook-store'
import { useCommandSource } from './command-source'
import { useExternalOpen } from './use-external-open'
import { useAutosave } from './use-autosave'
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
  useAutosave()

  const open = useWorkbookStore((state) => state.open)
  const path = useWorkbookStore((state) => state.path)
  const current = useWorkbookStore((state) => state.current)
  const problem = useWorkbookStore((state) => state.problem)
  const notice = useWorkbookStore((state) => state.notice)
  const dismiss = useWorkbookStore((state) => state.dismiss)
  const select = useWorkbookStore((state) => state.select)
  const selection = useWorkbookStore((state) => state.selection)
  const choose = useWorkbookStore((state) => state.choose)
  const edit = useWorkbookStore((state) => state.edit)
  const clear = useWorkbookStore((state) => state.clear)
  const fill = useWorkbookStore((state) => state.fill)
  const format = useWorkbookStore((state) => state.format)
  const resize = useWorkbookStore((state) => state.resize)
  const join = useWorkbookStore((state) => state.merge)
  const filterBy = useWorkbookStore((state) => state.filterBy)

  /** The header cell whose filter list is open, if one is. */
  const [filtering, setFiltering] = useState<CellAddress | null>(null)
  const size = useWindowSize()

  /**
   * Workbooks that were not closed cleanly, asked for once at startup.
   *
   * Offered rather than opened: somebody who has just had a crash is owed the
   * choice, and a program that reopened what it liked would be one you could
   * not get out of a bad state.
   */
  const [lost, setLost] = useState<Recoverable[]>([])

  useEffect(() => {
    void recoverable().then(setLost, () => {
      // Nothing to offer, which is the ordinary case and not a failure.
    })
  }, [])

  /** The text file somebody chose, while they answer what it is. */
  const [importing, setImporting] = useState<{
    bytes: Uint8Array
    name: string
    options: ImportOptions
  } | null>(null)

  useEffect(() => {
    const onAsk = () => {
      void pickCsv().then((chosen) => {
        if (chosen !== null) {
          setImporting({
            bytes: chosen.bytes,
            name: baseName(chosen.path),
            options: guessOptions(chosen.bytes),
          })
        }
      }, ignore)
    }

    window.addEventListener('orangery:import-csv', onAsk)
    return () => {
      window.removeEventListener('orangery:import-csv', onAsk)
    }
  }, [])

  const recover = useCallback((one: Recoverable) => {
    setLost((rest) => rest.filter((other) => other.key !== one.key))
    void recoverWorkbook(one.key, one.path)
  }, [])

  useEffect(() => {
    document.title = path === null ? 'Orangery Sheets' : baseName(path)
  }, [path])

  const sheets = open === null ? [] : visibleSheetsOf(open)
  const sheet = sheets[current] ?? null
  const tabsHeight = sheets.length > 0 ? 32 : 0
  const barHeight = sheet === null ? 0 : 33 + 37
  const selected = selectedCount(selection)

  /**
   * The filter list that is open, with the column it belongs to worked out
   * once.
   *
   * A filter counts its columns from the left of its own range and the grid
   * counts from the left of the sheet; getting the two mixed up filters the
   * wrong column, which is exactly the kind of thing that only shows up on a
   * table that does not start at A.
   */
  const filter = sheet?.sheet.autoFilter ?? null
  const openFilter =
    filtering === null || filter === null || sheet === null || open === null
      ? null
      : (() => {
          const column =
            filtering.column - Math.min(filter.range.from.column, filter.range.to.column)
          return { filter, column, choices: valuesIn(open, sheet, filter, column) }
        })()

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {lost.map((one) => (
        <div
          key={one.key}
          role="status"
          className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-xs"
        >
          <span className="text-muted">
            {`${one.path === null ? 'An unsaved workbook' : baseName(one.path)} was not closed properly.`}
          </span>
          <span className="flex gap-3">
            <button
              type="button"
              className="text-accent"
              onClick={() => {
                recover(one)
              }}
            >
              Recover
            </button>
            <button
              type="button"
              className="text-muted hover:text-text"
              onClick={() => {
                setLost((rest) => rest.filter((other) => other.key !== one.key))
              }}
            >
              Ignore
            </button>
          </span>
        </div>
      ))}

      {(problem ?? notice) !== null && (
        <div
          // A failure is announced; a notice is not. Both are worth reading,
          // and only one is worth interrupting somebody for.
          role={problem === null ? 'status' : 'alert'}
          className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-xs"
        >
          <span className={problem === null ? 'text-muted' : undefined}>{problem ?? notice}</span>
          <button type="button" onClick={dismiss} className="text-muted hover:text-text">
            Dismiss
          </button>
        </div>
      )}

      {sheet !== null && open !== null && (
        <Toolbar open={open} sheet={sheet} selection={selection} onFormat={format} onMerge={join} />
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
              size.height - tabsHeight - barHeight - ((problem ?? notice) === null ? 0 : 34),
              120,
            )}
            selection={selection}
            onSelectionChange={choose}
            onEdit={edit}
            onClear={clear}
            onFill={fill}
            onFilterClick={setFiltering}
            onResize={(axis, index, size) => {
              // Points on the screen, characters in the file: a column's width
              // is counted in the widest digit of the default font, which is
              // what the seven in `POINTS_PER_CHARACTER` stands for.
              resize(axis, index, index, axis === 'column' ? size / 7 : size - 5)
            }}
          />
        )}
      </main>

      {importing !== null && (
        <CsvWizard
          bytes={importing.bytes}
          name={importing.name}
          options={importing.options}
          onChange={(options) => {
            setImporting({ ...importing, options })
          }}
          onImport={() => {
            const chosen = importing
            setImporting(null)
            void workbookFromCsv(chosen.bytes, chosen.options).then((made) => {
              // Imported rather than opened: it came from a text file, and
              // saving it has to ask where the workbook should go.
              useWorkbookStore.setState({ open: made, path: null, edited: true })
            }, ignore)
          }}
          onCancel={() => {
            setImporting(null)
          }}
        />
      )}

      {openFilter !== null && (
        <FilterMenu
          filter={openFilter.filter}
          column={openFilter.column}
          choices={openFilter.choices}
          at={{ left: 8, top: barHeight + 40 }}
          onApply={(criteria) => {
            filterBy(openFilter.column, criteria)
            setFiltering(null)
          }}
          onClose={() => {
            setFiltering(null)
          }}
        />
      )}

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

/** A rejection nobody needs telling about, which is most of them here. */
const ignore = () => undefined

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
