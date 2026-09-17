import type { Editor } from '@tiptap/react'
import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { allCommands, isCommandEnabled, runCommand } from '../commands/registry'
import { searchCommands } from '../commands/search'
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
  const { editor } = useCurrentEditor()
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

  if (!isOpen || !editor) return null

  return (
    <PaletteDialog
      editor={editor}
      onClose={() => {
        setIsOpen(false)
        editor.commands.focus()
      }}
    />
  )
}

function PaletteDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const hits = searchCommands(allCommands(), query).filter((hit) =>
    isCommandEnabled(hit.command, { editor }),
  )

  const run = (id: string) => {
    onClose()
    runCommand(id, { editor })
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
