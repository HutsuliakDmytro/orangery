import { useEffect, useRef } from 'react'

export interface ConfirmChoice {
  label: string
  /** Rendered as the primary action. Exactly one choice should set this. */
  primary?: boolean
  /** Rendered in the danger colour, for the destructive option. */
  danger?: boolean
  onChoose: () => void
}

/**
 * Modal confirmation. Used for the unsaved-changes prompt, where the wording
 * follows macOS: Save / Don't Save / Cancel, with Cancel as the escape route.
 */
export function ConfirmDialog({
  title,
  message,
  choices,
  onCancel,
}: {
  title: string
  message: string
  choices: ConfirmChoice[]
  onCancel: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('button[data-primary="true"]')?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(420px,90vw)] rounded-lg border border-border bg-surface p-5 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <h2 className="mb-2 text-sm font-medium text-text">{title}</h2>
        <p className="mb-4 text-sm text-muted">{message}</p>

        <div className="flex justify-end gap-2">
          {choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              data-primary={choice.primary === true}
              onClick={choice.onChoose}
              className={
                choice.primary === true
                  ? 'rounded bg-accent px-3 py-1 text-sm text-black'
                  : choice.danger === true
                    ? 'rounded border border-danger px-3 py-1 text-sm text-danger'
                    : 'rounded border border-border px-3 py-1 text-sm text-text'
              }
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
