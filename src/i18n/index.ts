import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import uk from './locales/uk.json'
import type { UiLanguage } from '../store/settings-store'

/**
 * UI localisation.
 *
 * English and Ukrainian ship with the app; every string lives in the JSON files
 * rather than inline, so a missing translation is visible as a missing key
 * rather than as English text hiding in a Ukrainian interface.
 *
 * Note this covers the *interface* only. Document content is the user's, and
 * nothing here touches it.
 */

export const SUPPORTED_LANGUAGES: readonly UiLanguage[] = ['en', 'uk']

export const LANGUAGE_NAMES: Readonly<Record<UiLanguage, string>> = {
  en: 'English',
  uk: 'Українська',
}

export function initI18n(language: UiLanguage = 'en'): typeof i18next {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        uk: { translation: uk },
      },
      interpolation: {
        // React escapes for us; double-escaping mangles apostrophes in Ukrainian.
        escapeValue: false,
      },
    })
  }

  return i18next
}

export function setLanguage(language: UiLanguage): void {
  // Called from an effect that can run before init in tests and in a webview
  // that failed to load its bundle; switching an uninitialised instance throws.
  if (!i18next.isInitialized) {
    initI18n(language)
    return
  }
  void i18next.changeLanguage(language)
}

export { i18next }
