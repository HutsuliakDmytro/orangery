import { useEffect } from 'react'
import { effectiveTheme, useViewStore } from '../store/view-store'

/**
 * Applies the theme to the document.
 *
 * A single attribute on `<html>`; the tokens in `@orangery/ui-kit/tokens.css`
 * do the rest, so switching costs no re-render.
 */
export function useTheme(): void {
  const theme = useViewStore((state) => state.theme)

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset['theme'] = effectiveTheme(theme)
    }

    apply()
    if (theme !== 'system') return

    // Following the system means reacting when the system changes, not only at
    // startup.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
    }
  }, [theme])
}
