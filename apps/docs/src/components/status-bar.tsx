import { useTranslation } from 'react-i18next'
import { useDeferredStatistics } from '../editor/use-deferred-statistics'

/** Word, character and approximate page counts, as in the Docs status bar. */
export function StatusBar() {
  const { t } = useTranslation()
  const stats = useDeferredStatistics()

  return (
    <footer className="flex items-center gap-4 border-t border-border px-4 py-1 text-xs text-muted">
      <span>{t('status.words', { count: stats.words })}</span>
      <span>{t('status.characters', { count: stats.characters })}</span>
      <span title={t('status.pagesEstimate')}>{t('status.pages', { count: stats.pages })}</span>
    </footer>
  )
}
