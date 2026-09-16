import { useEffect } from 'react'
import { effectiveTheme, useSettingsStore } from '../store/settings-store'
import { setLanguage } from '../i18n'

/**
 * Applies the theme and language settings to the document.
 *
 * The theme is a single attribute on `<html>`; the tokens in `tokens.css` do the
 * rest, so switching costs no re-render (`docs/adr/0001-tech-stack.md`).
 */
export function useTheme(): void {
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const load = useSettingsStore((state) => state.load)
  const loaded = useSettingsStore((state) => state.loaded)

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

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

  useEffect(() => {
    setLanguage(language)
    document.documentElement.lang = language
  }, [language])
}
