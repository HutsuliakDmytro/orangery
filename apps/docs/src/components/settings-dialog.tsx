import { useTranslation } from 'react-i18next'
import { ALL_FONTS } from '../editor/fonts'
import { FONT_SIZE_PRESETS } from '@orangery/editor-text'
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n'
import { useSettingsStore } from '../store/settings-store'
import type { ThemePreference, UiLanguage } from '../store/settings-store'
import { PickerPopover } from '@orangery/ui-kit'

const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system']

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const update = useSettingsStore((state) => state.update)

  return (
    <PickerPopover title={t('settings.title')} onClose={onClose}>
      <div className="flex w-80 flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t('settings.theme')}</span>
          <select
            value={settings.theme}
            onChange={(event) => {
              update({ theme: event.target.value as ThemePreference })
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t(`settings.theme${theme.charAt(0).toUpperCase()}${theme.slice(1)}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t('settings.language')}</span>
          <select
            value={settings.language}
            onChange={(event) => {
              update({ language: event.target.value as UiLanguage })
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          >
            {SUPPORTED_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {LANGUAGE_NAMES[language]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-muted">{t('settings.defaultFont')}</span>
            <select
              value={settings.defaultFontFamily}
              onChange={(event) => {
                update({ defaultFontFamily: event.target.value })
              }}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
            >
              {ALL_FONTS.map((font) => (
                <option key={font.family} value={font.family}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex w-24 flex-col gap-1">
            <span className="text-xs text-muted">{t('settings.defaultFontSize')}</span>
            <select
              value={String(settings.defaultFontSize)}
              onChange={(event) => {
                update({ defaultFontSize: Number.parseFloat(event.target.value) })
              }}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
            >
              {FONT_SIZE_PRESETS.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={settings.smartTyping}
            onChange={(event) => {
              update({ smartTyping: event.target.checked })
            }}
            className="accent-accent"
          />
          {t('settings.smartTyping')}
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={settings.autosaveEnabled}
            onChange={(event) => {
              update({ autosaveEnabled: event.target.checked })
            }}
            className="accent-accent"
          />
          {t('settings.autosave')}
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={settings.keepBackups}
            onChange={(event) => {
              update({ keepBackups: event.target.checked })
            }}
            className="accent-accent"
          />
          {t('settings.backups')}
        </label>

        <div className="flex justify-end border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-accent px-3 py-1 text-sm text-black"
          >
            {t('settings.done')}
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}
