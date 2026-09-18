import { Presentation } from 'lucide-react'
import { useCommand } from '@orangery/ui-kit'

/**
 * What the window shows before there is a deck.
 *
 * The two buttons are the registry's own commands, so they grey out exactly
 * when the menu items do — New never, since a deck is built in memory, and Open
 * only outside the shell, where there is no file dialog to open one with.
 */
export function WelcomeScreen() {
  const create = useCommand('file.new')
  const open = useCommand('file.open')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <Presentation aria-hidden className="h-12 w-12 text-accent" />

      <div>
        <h1 className="text-xl font-medium text-text">Orangery Slides</h1>
        <p className="mt-1 text-sm text-muted">
          Presentations in PowerPoint&rsquo;s own format, kept as they were written.
        </p>
      </div>

      <div className="flex gap-2">
        {[create, open].map((command) => (
          <button
            key={command.command?.id ?? command.label}
            type="button"
            disabled={!command.isEnabled}
            onClick={command.run}
            className="rounded border border-border px-3 py-1.5 text-sm text-text disabled:cursor-not-allowed disabled:text-muted"
          >
            {command.label}
          </button>
        ))}
      </div>
    </div>
  )
}
