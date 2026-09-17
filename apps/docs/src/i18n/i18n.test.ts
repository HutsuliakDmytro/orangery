import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import uk from './locales/uk.json'
import { initI18n, LANGUAGE_NAMES, setLanguage, SUPPORTED_LANGUAGES } from './index'

type Bundle = Record<string, Record<string, string>>

/** Plural suffixes differ per language, so they are compared separately. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/u

function baseKeys(bundle: Bundle): string[] {
  return Object.entries(bundle)
    .flatMap(([section, entries]) =>
      Object.keys(entries).map((key) => `${section}.${key.replace(PLURAL_SUFFIX, '')}`),
    )
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort()
}

describe('translation bundles', () => {
  it('cover the same keys in both languages', () => {
    expect(baseKeys(uk as Bundle)).toEqual(baseKeys(en as Bundle))
  })

  it('have no empty strings', () => {
    for (const [language, bundle] of [
      ['en', en],
      ['uk', uk],
    ] as const) {
      for (const [section, entries] of Object.entries(bundle as Bundle)) {
        for (const [key, value] of Object.entries(entries)) {
          expect(value.trim(), `${language}:${section}.${key}`).not.toBe('')
        }
      }
    }
  })

  it('keep the same interpolation placeholders in both languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]).sort()

    for (const [section, entries] of Object.entries(en as Bundle)) {
      for (const [key, value] of Object.entries(entries)) {
        const translated = (uk as Bundle)[section]?.[key]
        if (translated === undefined) continue
        expect(placeholders(translated), `${section}.${key}`).toEqual(placeholders(value))
      }
    }
  })

  it('give Ukrainian the plural forms its grammar needs', () => {
    // Ukrainian distinguishes one / few / many, unlike English's one / other.
    const words = (uk as Bundle)['status'] ?? {}
    expect(Object.keys(words)).toEqual(
      expect.arrayContaining(['words_one', 'words_few', 'words_many']),
    )
  })
})

describe('initI18n', () => {
  it('translates into the selected language', () => {
    // The instance is already initialised by the test setup, so the language is
    // switched rather than set at init — which is also what the app does.
    setLanguage('uk')
    expect(initI18n().t('settings.title')).toBe('Налаштування')
  })

  it('switches language at runtime', () => {
    initI18n('uk')
    setLanguage('en')
    expect(initI18n().t('settings.title')).toBe('Settings')
  })

  it('falls back to English for a key a language is missing', () => {
    setLanguage('uk')
    expect(initI18n().t('app.name')).toBe('Orangery Docs')
  })

  it('lists exactly the languages it has bundles for', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['en', 'uk'])
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual(['en', 'uk'])
  })
})
