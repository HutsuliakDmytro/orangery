import type { LucideIcon } from 'lucide-react'
import { useCommand } from '../commands/use-command'

/**
 * One toolbar control, bound to a registry command.
 *
 * Label, shortcut, active and enabled state all come from the registry — the
 * button holds no logic of its own, so it can never disagree with the menu or
 * the palette (`docs/adr/0002-command-registry.md`).
 */
export function ToolbarButton({ id, icon: Icon }: { id: string; icon: LucideIcon }) {
  const { label, shortcut, isActive, isEnabled, run } = useCommand(id)

  return (
    <button
      type="button"
      // The editor keeps focus: a toolbar button that takes it leaves the next
      // keystroke going to the button instead of the document. Pressing Enter
      // after clicking would re-activate the button rather than start a new
      // paragraph.
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={run}
      disabled={!isEnabled}
      aria-label={label}
      aria-pressed={isActive}
      title={shortcut === null ? label : `${label} (${shortcut})`}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors ${
        isActive ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-2'
      } disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent`}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  )
}

export function ToolbarSeparator() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
}
