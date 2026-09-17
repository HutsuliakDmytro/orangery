import { useCallback } from 'react'

/**
 * The strip between two panels.
 *
 * Pointer capture rather than window listeners: the pointer leaving the handle
 * mid-drag is the normal case, not an edge one, and capture keeps the events
 * coming to the element that started the drag.
 */
export function ResizeHandle({
  orientation,
  label,
  onResize,
}: {
  orientation: 'vertical' | 'horizontal'
  label: string
  /** Called with the pointer position in client coordinates. */
  onResize: (position: number) => void
}) {
  const vertical = orientation === 'vertical'

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.buttons === 0) return
      onResize(vertical ? event.clientX : event.clientY)
    },
    [onResize, vertical],
  )

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      className={`shrink-0 bg-border transition-colors hover:bg-accent ${
        vertical ? 'w-px cursor-col-resize hover:w-0.5' : 'h-px cursor-row-resize hover:h-0.5'
      }`}
    />
  )
}
