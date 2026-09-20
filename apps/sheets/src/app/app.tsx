import { useCallback, useEffect, useState } from 'react'
import type { CellAddress } from '@orangery/grid'
import { CommandPalette, CommandSourceProvider, useNativeMenu } from '@orangery/ui-kit'
import { baseName } from '@orangery/platform'
import { selectedCount } from '@orangery/grid'
import {
  cellAt,
  formatCodeOf,
  formatReference,
  parseReference,
  resolveStyle,
} from '@orangery/ooxml-spreadsheet'
import { registerBuiltinCommands } from '../commands/definitions'
import { openWorkbookFromDialog, recoverWorkbook } from '../document/file'
import { recoverable } from '../document/autosave'
import { guessOptions, pickCsv, workbookFromCsv } from '../document/csv-file'
import type { ImportOptions } from '../document/csv-file'
import { CsvWizard } from '../render/csv-wizard'
import type { Recoverable } from '../document/autosave'
import { valuesIn } from '../document/filter'
import { linkAt } from '../document/links'
import { FilterMenu } from '../render/filter-menu'
import { editableText } from '../document/shown'
import { FormulaBar } from '../render/formula-bar'
import { ReferenceBox } from '../render/reference-box'
import { Toolbar } from '../render/toolbar'
import { FindPanel } from '../render/find-panel'
import { FormatDialog } from '../render/format-dialog'
import { GoalSeekDialog } from '../render/goal-seek-dialog'
import { LinkDialog } from '../render/link-dialog'
import { SheetTabs } from '../render/sheet-tabs'
import { SheetView } from '../render/sheet-view'
import { SortDialog } from '../render/sort-dialog'
import { seekGoal, sortTarget, useWorkbookStore, visibleSheetsOf } from '../store/workbook-store'
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
  const fillSeries = useWorkbookStore((state) => state.fillSeries)
  const addSheet = useWorkbookStore((state) => state.addSheet)
  const renameSheet = useWorkbookStore((state) => state.renameSheet)
  const removeSheet = useWorkbookStore((state) => state.removeSheet)
  const moveSheet = useWorkbookStore((state) => state.moveSheet)
  const hideSheet = useWorkbookStore((state) => state.hideSheet)
  const colorTab = useWorkbookStore((state) => state.colorTab)
  const findNext = useWorkbookStore((state) => state.findNext)
  const putLink = useWorkbookStore((state) => state.putLink)
  const removeLink = useWorkbookStore((state) => state.removeLink)
  const followLink = useWorkbookStore((state) => state.followLink)
  const replaceOne = useWorkbookStore((state) => state.replaceOne)
  const replaceEverywhere = useWorkbookStore((state) => state.replaceEverywhere)

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

  /** The format dialog, with the code and the value the cursor is on. */
  const [formatting, setFormatting] = useState<{
    code: string
    value: number | null
  } | null>(null)

  useEffect(() => {
    const onAsk = () => {
      const { open: workbook, current: at, selection: where } = useWorkbookStore.getState()
      if (workbook === null || workbook.styles === null) return

      const sheet = visibleSheetsOf(workbook)[at]
      const cell = sheet?.cells.rows.get(where.active.row)?.get(where.active.column) ?? null
      const number = cell === null || cell.value === null ? Number.NaN : Number(cell.value)

      setFormatting({
        // A cell with no format of its own shows everything as it comes,
        // which is what `General` means and what the box should start at.
        code:
          formatCodeOf(
            workbook.styles,
            resolveStyle(workbook.styles, cell?.style ?? null).numberFormat,
          ) ?? 'General',
        value: Number.isFinite(number) ? number : null,
      })
    }

    window.addEventListener('orangery:format-cells', onAsk)
    return () => {
      window.removeEventListener('orangery:format-cells', onAsk)
    }
  }, [])

  /** The link dialog, and what the cell under the cursor already links to. */
  const [linking, setLinking] = useState<{ address: string; tooltip: string } | null>(null)

  useEffect(() => {
    const onAsk = () => {
      const { open: workbook, current: at, selection: where } = useWorkbookStore.getState()
      if (workbook === null) return

      const sheet = visibleSheetsOf(workbook)[at]
      const link = sheet === undefined ? null : linkAt(sheet, where.active)

      setLinking({
        address: link === null ? '' : (link.target ?? link.location ?? ''),
        tooltip: link?.tooltip ?? '',
      })
    }

    window.addEventListener('orangery:link', onAsk)
    return () => {
      window.removeEventListener('orangery:link', onAsk)
    }
  }, [])

  /** Whether the find strip is showing, which `Mod+F` turns on. */
  const [finding, setFinding] = useState(false)

  useEffect(() => {
    const onAsk = () => {
      setFinding(true)
    }

    window.addEventListener('orangery:find', onAsk)
    return () => {
      window.removeEventListener('orangery:find', onAsk)
    }
  }, [])

  /** The table a sort dialog is open over, with its columns named. */
  const [sorting, setSorting] = useState<{
    columns: string[]
    header: boolean
    left: number
  } | null>(null)

  useEffect(() => {
    const onAsk = () => {
      setSorting(sortTarget())
    }

    window.addEventListener('orangery:sort-range', onAsk)
    return () => {
      window.removeEventListener('orangery:sort-range', onAsk)
    }
  }, [])

  /** Whether the Goal Seek dialog is open, and over which cell. */
  const [seeking, setSeeking] = useState<string | null>(null)

  useEffect(() => {
    const onAsk = () => {
      setSeeking(formatReference(useWorkbookStore.getState().selection.active))
    }

    window.addEventListener('orangery:goal-seek', onAsk)
    return () => {
      window.removeEventListener('orangery:goal-seek', onAsk)
    }
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
  const barHeight = (sheet === null ? 0 : 33 + 37) + (finding ? 30 : 0)
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

      {finding && sheet !== null && (
        <FindPanel
          onFind={findNext}
          onReplace={replaceOne}
          onReplaceAll={replaceEverywhere}
          onClose={() => {
            setFinding(false)
          }}
        />
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
          <FormulaBar
            text={open === null ? '' : editableText(open, cellAt(sheet.cells, selection.active))}
            onCommit={(text) => {
              edit(selection.active, text)
            }}
          />
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
            onFillSeries={fillSeries}
            onCellClick={followLink}
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

      {formatting !== null && open !== null && (
        <FormatDialog
          code={formatting.code}
          value={formatting.value}
          date1904={open.workbook.date1904}
          onApply={(code) => {
            setFormatting(null)
            format({ numberFormat: code })
          }}
          onCancel={() => {
            setFormatting(null)
          }}
        />
      )}

      {linking !== null && (
        <LinkDialog
          address={linking.address}
          tooltip={linking.tooltip}
          onApply={(address, tooltip) => {
            setLinking(null)
            putLink(address, tooltip)
          }}
          onRemove={() => {
            setLinking(null)
            removeLink()
          }}
          onCancel={() => {
            setLinking(null)
          }}
        />
      )}

      {seeking !== null && (
        <GoalSeekDialog
          target={seeking}
          onCancel={() => {
            setSeeking(null)
          }}
          onSeek={(asked) => {
            setSeeking(null)
            void (async () => {
              const target = parseReference(asked.target)
              const changing = parseReference(asked.changing)
              const wanted = Number(asked.wanted)

              if (target === null || changing === null || !Number.isFinite(wanted)) {
                useWorkbookStore.setState({
                  notice: 'Goal Seek needs two cell addresses and a number.',
                })
                return
              }

              const found = await seekGoal({ target, wanted, changing })
              if (found === null) {
                useWorkbookStore.setState({
                  notice: `No value for ${asked.changing} makes ${asked.target} come to ${asked.wanted}.`,
                })
              }
            })()
          }}
        />
      )}

      {sorting !== null && (
        <SortDialog
          columns={sorting.columns}
          header={sorting.header}
          onSort={(keys, header) => {
            const where = sorting
            setSorting(null)
            // The dialog counts columns from the left of the table and the
            // sheet counts from the left of the sheet; a table that does not
            // start at A is where the difference shows.
            useWorkbookStore.getState().sortWith(
              keys.map((key) => ({ ...key, column: where.left + key.column })),
              header,
            )
          }}
          onCancel={() => {
            setSorting(null)
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

      {sheets.length > 0 && open !== null && (
        <SheetTabs
          open={open}
          sheets={sheets}
          current={current}
          onSelect={select}
          onAdd={addSheet}
          onRename={renameSheet}
          onRemove={removeSheet}
          onMove={moveSheet}
          onHide={hideSheet}
          onColor={colorTab}
        />
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
