import { useState } from 'react'

/**
 * File → Open Recent, as a dropdown.
 *
 * Presentational on purpose: it is handed a list and calls back with a path.
 * Which files are recent, and what opening one means, differ between a
 * document and a deck; a dropdown of paths does not.
 */

export interface RecentEntry {
  path: string
  name: string
}

export function RecentFilesMenu({
  files,
  onPick,
  label = 'Recent',
}: {
  files: readonly RecentEntry[]
  onPick: (path: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)

  // Nothing to offer: a button that opens an empty list is a button that lies
  // about there being something behind it.
  if (files.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-border px-2 py-0.5 text-xs text-muted"
      >
        {label}
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded border border-border bg-surface shadow-xl"
        >
          {files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                role="menuitem"
                // The full path in the tooltip: two files can share a name, and
                // the list would otherwise offer the same entry twice.
                title={file.path}
                onClick={() => {
                  setOpen(false)
                  onPick(file.path)
                }}
                className="w-full truncate px-3 py-1.5 text-left text-xs text-text"
              >
                {file.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
