import { useEffect, useRef, useState } from 'react'
import { allCommands, isCommandEnabled, runCommand } from '../commands/registry'
import { searchCommands } from '../commands/search'
import { useCommandSource } from '../commands/source'
import type { CommandContext } from '../commands/types'
import { formatShortcut, hasMod } from '@orangery/platform'

const PALETTE_SHORTCUT_KEY = 'p'

/**
 * `Mod+Shift+P`. Lists every registered command — the palette is a projection of
 * the registry, so a command is reachable here the moment it is registered.
 *
 * The dialog is a separate component mounted only while open, so its command list
 * is rebuilt on every open and can never show a stale enabled-state.
 */
export function CommandPalette() {
  const source = useCommandSource()
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (hasMod(event) && event.shiftKey && event.key.toLowerCase() === PALETTE_SHORTCUT_KEY) {
        event.preventDefault()
        setIsOpen((open) => !open)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const context = source?.read() ?? null
  if (!isOpen || context === null) return null

  return (
    <PaletteDialog
      context={context}
      onClose={() => {
        setIsOpen(false)
      }}
    />
  )
}

function PaletteDialog({ context, onClose }: { context: CommandContext; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Whatever had focus gets it back on close — the editor, a panel, a field.
    // Restoring it here rather than naming the editor is what lets the palette
    // sit over a deck as readily as over a document.
    const restore = document.activeElement
    inputRef.current?.focus()

    return () => {
      if (restore instanceof HTMLElement) restore.focus()
    }
  }, [])

  const hits = searchCommands(allCommands(), query).filter((hit) =>
    isCommandEnabled(hit.command, context),
  )

  const run = (id: string) => {
    onClose()
    runCommand(id, context)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((index) => Math.min(index + 1, hits.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[selected]
      if (hit) run(hit.command.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[min(560px,90vw)] overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search commands…"
          aria-label="Search commands"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-text outline-none placeholder:text-muted"
        />

        <ul className="max-h-[50vh] overflow-auto py-1">
          {hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">No matching command</li>
          )}

          {hits.map((hit, index) => (
            <li key={hit.command.id}>
              <button
                type="button"
                onMouseEnter={() => {
                  setSelected(index)
                }}
                onClick={() => {
                  run(hit.command.id)
                }}
                aria-selected={index === selected}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  index === selected ? 'bg-accent-soft' : ''
                } text-text`}
              >
                <span>{hit.command.label}</span>
                {hit.command.shortcut && (
                  <span className="text-xs text-muted">{formatShortcut(hit.command.shortcut)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
