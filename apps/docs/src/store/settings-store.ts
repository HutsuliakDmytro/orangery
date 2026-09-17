import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { appDataRoot } from '@orangery/platform'
import { isTauri } from '@orangery/platform'
import { DEFAULT_FONT_FAMILY } from '../editor/fonts'
import { DEFAULT_FONT_SIZE } from '@orangery/editor-text'

/**
 * User settings, persisted to app data.
 *
 * Separate from both document and view state: these outlive any one document
 * and any one window.
 */

export const SETTINGS_NAME = 'settings.json'

export type ThemePreference = 'dark' | 'light' | 'system'
export type UiLanguage = 'en' | 'uk'

export interface Settings {
  theme: ThemePreference
  language: UiLanguage
  defaultFontFamily: string
  defaultFontSize: number
  autosaveEnabled: boolean
  keepBackups: boolean
  /** Typographic substitutions while typing — quotes, dashes, the ellipsis. */
  smartTyping: boolean
  /** Signed on comments and tracked changes; empty means the file says nobody. */
  authorName: string
}

export const DEFAULT_SETTINGS: Settings = {
  // Dark is the default (CLAUDE.md "Design system").
  theme: 'dark',
  language: 'en',
  defaultFontFamily: DEFAULT_FONT_FAMILY,
  defaultFontSize: DEFAULT_FONT_SIZE,
  autosaveEnabled: true,
  keepBackups: true,
  smartTyping: true,
  authorName: '',
}

/** Rejects anything not recognised rather than trusting the file on disk. */
export function parseSettings(contents: string): Settings {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }

  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS }
  const candidate = parsed as Record<string, unknown>

  const theme = candidate['theme']
  const language = candidate['language']
  const fontFamily = candidate['defaultFontFamily']
  const fontSize = candidate['defaultFontSize']

  return {
    theme:
      theme === 'light' || theme === 'system' || theme === 'dark' ? theme : DEFAULT_SETTINGS.theme,
    language: language === 'uk' || language === 'en' ? language : DEFAULT_SETTINGS.language,
    defaultFontFamily:
      typeof fontFamily === 'string' && fontFamily !== ''
        ? fontFamily
        : DEFAULT_SETTINGS.defaultFontFamily,
    defaultFontSize:
      typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0
        ? fontSize
        : DEFAULT_SETTINGS.defaultFontSize,
    autosaveEnabled:
      typeof candidate['autosaveEnabled'] === 'boolean'
        ? candidate['autosaveEnabled']
        : DEFAULT_SETTINGS.autosaveEnabled,
    keepBackups:
      typeof candidate['keepBackups'] === 'boolean'
        ? candidate['keepBackups']
        : DEFAULT_SETTINGS.keepBackups,
    smartTyping:
      typeof candidate['smartTyping'] === 'boolean'
        ? candidate['smartTyping']
        : DEFAULT_SETTINGS.smartTyping,
    authorName:
      typeof candidate['authorName'] === 'string'
        ? candidate['authorName']
        : DEFAULT_SETTINGS.authorName,
  }
}

/** Resolves `system` against the OS preference. */
export function effectiveTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference !== 'system') return preference

  // `matchMedia` is missing in jsdom and in some older webviews; dark is the
  // product default, so that is the safe answer when the OS cannot be asked.
  // Present but not callable in jsdom, so `in` is not enough of a check.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

export interface SettingsState extends Settings {
  loaded: boolean
  update: (patch: Partial<Settings>) => void
  load: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  update: (patch) => {
    set(patch)

    // Picked by the keys of the defaults rather than destructured by hand: a
    // setting added to `Settings` is then persisted without anyone having to
    // remember to list it here, which is how one gets silently dropped.
    const state = get()
    const settings = Object.fromEntries(
      SETTING_KEYS.map((key) => [key, state[key]]),
    ) as unknown as Settings

    void persist(settings)
  },

  load: async () => {
    if (!isTauri()) {
      set({ loaded: true })
      return
    }

    const contents = await invoke<string | null>('read_autosave', {
      directory: await appDataRoot(),
      name: SETTINGS_NAME,
    })

    set({ ...(contents === null ? DEFAULT_SETTINGS : parseSettings(contents)), loaded: true })
  },
}))

async function persist(settings: Settings): Promise<void> {
  if (!isTauri()) return
  await invoke('write_autosave', {
    directory: await appDataRoot(),
    name: SETTINGS_NAME,
    contents: JSON.stringify(settings),
  })
}
