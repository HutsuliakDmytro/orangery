import { FileText, FolderOpen, Mail, NotebookPen } from 'lucide-react'
import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadRecentFiles } from '../document/recent-files'
import type { RecentFile } from '../document/recent-files'
import { TEMPLATES } from '../document/templates'
import type { TemplateId } from '../document/templates'
import { fileOperations } from '../editor/commands/file-actions'

/**
 * Shown when the app opens with an empty, never-saved document — the moment a
 * user has nothing to work on. It disappears as soon as anything is typed, so it
 * never stands between the user and the page.
 */
export function WelcomeScreen({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation()
  const { editor } = useCurrentEditor()
  const [recent, setRecent] = useState<RecentFile[]>([])

  useEffect(() => {
    void (async () => {
      setRecent(await loadRecentFiles())
    })()
  }, [])

  const icons: Record<TemplateId, typeof FileText> = {
    blank: FileText,
    letter: Mail,
    report: NotebookPen,
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-bg px-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-accent">{t('welcome.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('welcome.subtitle')}</p>
      </header>

      <div className="flex flex-wrap justify-center gap-3">
        {TEMPLATES.map((template) => {
          const Icon = icons[template.id]
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                if (!editor) return
                void fileOperations.newDocument(editor, template.id)
                onDismiss()
              }}
              className="flex h-28 w-36 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm text-text hover:border-accent"
            >
              <Icon size={22} strokeWidth={1.5} aria-hidden className="text-accent" />
              {t(`welcome.${template.id}`)}
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => {
            if (!editor) return
            void fileOperations.open(editor)
            onDismiss()
          }}
          className="flex h-28 w-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted hover:border-accent hover:text-text"
        >
          <FolderOpen size={22} strokeWidth={1.5} aria-hidden />
          {t('welcome.open')}
        </button>
      </div>

      <section className="w-full max-w-md">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          {t('welcome.recent')}
        </h2>

        {recent.length === 0 ? (
          <p className="text-xs text-muted">{t('welcome.noRecent')}</p>
        ) : (
          <ul className="flex flex-col">
            {recent.slice(0, 6).map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  title={file.path}
                  onClick={() => {
                    if (!editor) return
                    void fileOperations.open(editor, file.path)
                    onDismiss()
                  }}
                  className="w-full truncate rounded px-2 py-1.5 text-left text-sm text-text hover:bg-surface"
                >
                  {file.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
