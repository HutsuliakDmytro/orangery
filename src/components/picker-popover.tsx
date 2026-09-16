import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

/**
 * Shared shell for the formatting pickers: centred panel, Escape to dismiss,
 * click-outside to dismiss, focus moved inside on open.
 */
export function PickerPopover({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[18vh]"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="rounded-lg border border-border bg-surface p-4 shadow-2xl"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <h2 className="mb-3 text-sm font-medium text-text">{title}</h2>
        {children}
      </div>
    </div>
  )
}
