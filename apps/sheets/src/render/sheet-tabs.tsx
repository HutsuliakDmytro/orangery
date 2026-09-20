import { useState } from 'react'
import type { OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * The strip of tabs along the bottom.
 *
 * What a person does here is switch sheets, which is a click, so everything
 * else is behind a right click and out of the way: renaming, duplicating,
 * moving, hiding, a colour, and deleting — the one that asks first, because
 * none of this can be taken back.
 *
 * A tab's colour is a stripe under it rather than a wash over it. A coloured
 * tab has to stay readable, and the current sheet is already marked by a line
 * of its own.
 */

export interface SheetTabsProps {
  open: OpenWorkbook
  sheets: readonly OpenSheet[]
  current: number
  onSelect: (index: number) => void
  onAdd: (options?: { duplicate?: boolean }) => void
  onRename: (path: string, name: string) => void
  onRemove: (path: string) => void
  /** Moved to where the sheet at that position is now. */
  onMove: (path: string, before: number) => void
  onHide: (path: string, hidden: boolean) => void
  onColor: (path: string, color: string | null) => void
}

const COLORS: { label: string; value: string | null }[] = [
  { label: 'No colour', value: null },
  { label: 'Orange', value: 'FFFF7A00' },
  { label: 'Red', value: 'FFD64545' },
  { label: 'Green', value: 'FF3E9E56' },
  { label: 'Blue', value: 'FF3B7DD8' },
  { label: 'Grey', value: 'FF8A8A8A' },
]

/** `FFRRGGBB` as a colour a browser understands, alpha dropped. */
const cssColor = (rgb: string | null): string | undefined =>
  rgb === null ? undefined : `#${rgb.length === 8 ? rgb.slice(2) : rgb}`

export function SheetTabs({
  open,
  sheets,
  current,
  onSelect,
  onAdd,
  onRename,
  onRemove,
  onMove,
  onHide,
  onColor,
}: SheetTabsProps) {
  /** The tab whose menu is open, if one is. */
  const [menu, setMenu] = useState<number | null>(null)

  /** The tab being renamed, and what has been typed into it so far. */
  const [naming, setNaming] = useState<{ index: number; text: string } | null>(null)

  const hidden = open.sheets.filter((one) => one.hidden)

  return (
    <nav
      aria-label="Sheets"
      className="relative flex h-8 items-stretch gap-px border-t border-border"
    >
      <button
        type="button"
        aria-label="Add sheet"
        className="px-3 text-sm text-muted hover:text-text"
        onClick={() => {
          onAdd()
        }}
      >
        +
      </button>

      {sheets.map((one, index) => (
        <div key={one.path} className="relative flex items-stretch">
          {naming?.index === index ? (
            <input
              // Typed over the tab itself: renaming is a change to the thing
              // being pointed at, not a dialog about it.
              aria-label="Sheet name"
              autoFocus
              value={naming.text}
              className="w-24 bg-surface px-2 text-xs outline-none"
              onChange={(event) => {
                setNaming({ index, text: event.target.value })
              }}
              onBlur={() => {
                if (naming.text.trim() !== '') onRename(one.path, naming.text.trim())
                setNaming(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (naming.text.trim() !== '') onRename(one.path, naming.text.trim())
                  setNaming(null)
                }
                if (event.key === 'Escape') setNaming(null)
              }}
            />
          ) : (
            <button
              type="button"
              aria-current={index === current}
              className={`px-3 text-xs ${
                index === current
                  ? 'border-b-2 border-accent text-text'
                  : 'text-muted hover:text-text'
              }`}
              style={
                index === current || one.sheet.tabColor === null
                  ? undefined
                  : { boxShadow: `inset 0 -2px 0 ${cssColor(one.sheet.tabColor) ?? ''}` }
              }
              onClick={() => {
                onSelect(index)
              }}
              onDoubleClick={() => {
                setNaming({ index, text: one.name })
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                onSelect(index)
                setMenu(index)
              }}
            >
              {one.name}
            </button>
          )}

          {menu === index && (
            <div
              role="menu"
              aria-label={`Sheet ${one.name}`}
              className="absolute bottom-8 left-0 z-20 w-44 rounded border border-border bg-surface py-1 text-xs shadow-lg"
              onMouseLeave={() => {
                setMenu(null)
              }}
            >
              <Item
                label="Rename"
                onPick={() => {
                  setMenu(null)
                  setNaming({ index, text: one.name })
                }}
              />
              <Item
                label="Duplicate"
                onPick={() => {
                  setMenu(null)
                  onAdd({ duplicate: true })
                }}
              />
              <Item
                label="Move left"
                disabled={index === 0}
                onPick={() => {
                  setMenu(null)
                  onMove(one.path, index - 1)
                }}
              />
              <Item
                label="Move right"
                disabled={index === sheets.length - 1}
                onPick={() => {
                  setMenu(null)
                  onMove(one.path, index + 1)
                }}
              />
              <Item
                label="Hide"
                disabled={sheets.length < 2}
                onPick={() => {
                  setMenu(null)
                  onHide(one.path, true)
                }}
              />

              <div className="my-1 border-t border-border" />
              {COLORS.map((color) => (
                <Item
                  key={color.label}
                  label={color.label}
                  swatch={cssColor(color.value)}
                  onPick={() => {
                    setMenu(null)
                    onColor(one.path, color.value)
                  }}
                />
              ))}

              <div className="my-1 border-t border-border" />
              <Item
                label="Delete"
                disabled={sheets.length < 2}
                onPick={() => {
                  setMenu(null)
                  // Asked rather than undone: a deleted sheet is not something
                  // the history can give back, so the question comes first.
                  if (window.confirm(`Delete “${one.name}”? This cannot be undone.`)) {
                    onRemove(one.path)
                  }
                }}
              />
            </div>
          )}
        </div>
      ))}

      {hidden.length > 0 && (
        <button
          type="button"
          aria-label="Show hidden sheets"
          className="px-3 text-xs text-muted hover:text-text"
          onClick={() => {
            // The first of them: a menu of hidden sheets is a menu people meet
            // once, and bringing one back is what they came for.
            const first = hidden[0]
            if (first !== undefined) onHide(first.path, false)
          }}
        >
          {`${String(hidden.length)} hidden`}
        </button>
      )}
    </nav>
  )
}

function Item({
  label,
  swatch,
  disabled,
  onPick,
}: {
  label: string
  swatch?: string
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled ?? false}
      className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-bg disabled:text-muted"
      onClick={onPick}
    >
      {swatch !== undefined && (
        <span
          aria-hidden
          className="h-3 w-3 rounded-sm border border-border"
          style={{ background: swatch }}
        />
      )}
      {label}
    </button>
  )
}
