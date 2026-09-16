import { useCallback, useEffect, useRef } from 'react'

/**
 * Roving tabindex for a toolbar.
 *
 * A toolbar with twenty focusable buttons means twenty Tab stops between the
 * document and whatever follows. The ARIA toolbar pattern makes the whole
 * toolbar one Tab stop and moves between controls with the arrow keys, which is
 * what screen-reader users expect and what Word and Docs do.
 *
 * `tabindex` is applied imperatively rather than through render props: the set
 * of controls changes as buttons enable and disable, and reading the DOM during
 * render to decide their attributes would be reading state we do not own.
 */
export function useRovingFocus(): {
  containerRef: React.RefObject<HTMLDivElement | null>
  onKeyDown: (event: React.KeyboardEvent) => void
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeIndex = useRef(0)

  const allControls = useCallback((): HTMLElement[] => {
    const container = containerRef.current
    if (!container) return []
    return [...container.querySelectorAll<HTMLElement>('button, select')]
  }, [])

  /** Only enabled controls take part in the rove; disabled ones cannot focus. */
  const controls = useCallback(
    (): HTMLElement[] => allControls().filter((element) => !element.hasAttribute('disabled')),
    [allControls],
  )

  const applyTabIndex = useCallback(() => {
    // Every control is taken out of the tab order first, including the disabled
    // ones: a disabled button keeps `tabindex="0"` by default, and when it is
    // enabled again the toolbar would have two Tab stops.
    for (const control of allControls()) control.tabIndex = -1

    const items = controls()
    if (items.length === 0) return

    if (activeIndex.current >= items.length) activeIndex.current = items.length - 1
    const active = items[activeIndex.current]
    if (active) active.tabIndex = 0
  }, [allControls, controls])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    applyTabIndex()

    // Buttons enable and disable as the selection moves, which changes the set.
    if (typeof MutationObserver !== 'function') return

    const observer = new MutationObserver(applyTabIndex)
    observer.observe(container, { attributes: true, subtree: true, attributeFilter: ['disabled'] })

    return () => {
      observer.disconnect()
    }
  }, [applyTabIndex])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const items = controls()
      if (items.length === 0) return

      const move = (next: number) => {
        event.preventDefault()
        activeIndex.current = (next + items.length) % items.length
        applyTabIndex()
        items[activeIndex.current]?.focus()
      }

      switch (event.key) {
        case 'ArrowRight':
          move(items.indexOf(event.target as HTMLElement) + 1)
          break
        case 'ArrowLeft':
          move(items.indexOf(event.target as HTMLElement) - 1)
          break
        case 'Home':
          move(0)
          break
        case 'End':
          move(items.length - 1)
          break
        default:
          break
      }
    },
    [applyTabIndex, controls],
  )

  return { containerRef, onKeyDown }
}
