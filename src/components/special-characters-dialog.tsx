import { useState } from 'react'
import { CHARACTER_GROUPS, searchCharacters } from '../editor/special-characters'
import { PickerPopover } from './picker-popover'

/** Insert a symbol. Searchable by name, because that is how people look. */
export function SpecialCharactersDialog({
  onPick,
  onClose,
}: {
  onPick: (character: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = query.trim() === '' ? null : searchCharacters(query)

  const pick = (character: string) => {
    onPick(character)
    onClose()
  }

  return (
    <PickerPopover title="Special characters" onClose={onClose}>
      <div className="flex w-96 flex-col gap-3">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search by name, e.g. dash"
          aria-label="Search characters"
          className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
        />

        <div className="max-h-[46vh] overflow-auto">
          {filtered !== null ? (
            <Grid characters={filtered} onPick={pick} />
          ) : (
            CHARACTER_GROUPS.map((group) => (
              <section key={group.id} className="mb-3">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                  {group.label}
                </h3>
                <Grid characters={group.characters} onPick={pick} />
              </section>
            ))
          )}

          {filtered?.length === 0 && <p className="text-xs text-muted">No matching character</p>}
        </div>
      </div>
    </PickerPopover>
  )
}

function Grid({
  characters,
  onPick,
}: {
  characters: { char: string; name: string }[]
  onPick: (character: string) => void
}) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {characters.map((entry) => (
        <button
          key={`${entry.char}-${entry.name}`}
          type="button"
          title={entry.name}
          aria-label={entry.name}
          onClick={() => {
            onPick(entry.char)
          }}
          className="flex h-9 items-center justify-center rounded border border-border text-base text-text hover:border-accent"
        >
          {/* Invisible characters need a visible stand-in or the grid looks broken. */}
          {entry.char.trim() === '' ? '␣' : entry.char}
        </button>
      ))}
    </div>
  )
}
