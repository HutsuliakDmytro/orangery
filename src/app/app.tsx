import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandPalette } from '../components/command-palette'
import { ConfirmDialog } from '../components/confirm-dialog'
import { FindReplacePanel } from '../components/find-replace-panel'
import { FootnotesPanel } from '../components/footnotes-panel'
import { HeaderFooterEditor } from '../components/header-footer-editor'
import { FormatPickers } from '../components/format-pickers'
import { OutlinePanel } from '../components/outline-panel'
import { PageNumbersDialog } from '../components/page-numbers-dialog'
import { PageSetupDialog } from '../components/page-setup-dialog'
import { RecentFilesMenu } from '../components/recent-files-menu'
import { RecoveryBanner } from '../components/recovery-banner'
import { Ruler } from '../components/ruler'
import { SettingsDialog } from '../components/settings-dialog'
import { StatusBar } from '../components/status-bar'
import { Toolbar } from '../components/toolbar'
import { WarningsBanner } from '../components/warnings-banner'
import { WelcomeScreen } from '../components/welcome-screen'
import { useAutosave, useDirtyTracking } from '../document/use-autosave'
import { useCrashRecovery } from '../document/use-crash-recovery'
import { getSession } from '../document/session'
import { closePicker, useOpenPicker } from '../editor/commands/picker-store'
import { fileOperations } from '../editor/commands/file-actions'
import { EditorProvider } from '../editor/editor'
import { EditorSurface } from '../editor/editor-surface'
import { useDocumentStore, windowTitle } from '../store/document-store'
import { useHeaderFooterStore } from '../store/header-footer-store'
import { useViewStore } from '../store/view-store'
import { useCloseGuard } from './use-close-guard'
import { useExternalOpen } from './use-external-open'
import { useNativeMenu } from './menu/use-native-menu'
import { useTheme } from './use-theme'

function Shell() {
  const { t } = useTranslation()
  const { editor } = useCurrentEditor()
  const openPicker = useOpenPicker()
  const path = useDocumentStore((state) => state.path)
  const dirty = useDocumentStore((state) => state.dirty)
  const markDirty = useDocumentStore((state) => state.markDirty)
  const section = useViewStore((state) => state.section)
  const headerText = useHeaderFooterStore((state) => state.header)
  const footerText = useHeaderFooterStore((state) => state.footer)
  const setHeader = useHeaderFooterStore((state) => state.setHeader)
  const setFooter = useHeaderFooterStore((state) => state.setFooter)
  const setSection = useViewStore((state) => state.setSection)

  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  useTheme()
  useNativeMenu()
  useDirtyTracking()
  useAutosave()
  useExternalOpen()

  const closeGuard = useCloseGuard()
  const recovery = useCrashRecovery()

  // A new document is a real DOCX package from the first keystroke, so there is
  // never a moment where the app holds something that is not the native format.
  useEffect(() => {
    if (!editor || getSession() !== null) return
    void fileOperations.newDocument(editor)
  }, [editor])

  const title = windowTitle({ path, dirty })

  useEffect(() => {
    document.title = `${title} — ${t('app.name')}`
  }, [title, t])

  // Only shown when there is nothing to work on: no file, nothing typed.
  const showWelcome =
    !welcomeDismissed && path === null && !dirty && recovery.candidates.length === 0

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="font-medium text-text">{title}</span>
        {dirty && (
          <span
            aria-label={t('app.edited')}
            title={t('app.edited')}
            className="h-2 w-2 rounded-full bg-accent"
          />
        )}
        <div className="ml-auto">
          <RecentFilesMenu />
        </div>
      </header>

      <RecoveryBanner
        candidates={recovery.candidates}
        onRecover={recovery.recover}
        onDiscard={recovery.discard}
        onDiscardAll={recovery.discardAll}
      />
      <WarningsBanner />

      {showWelcome ? (
        <main className="min-h-0 flex-1">
          <WelcomeScreen
            onDismiss={() => {
              setWelcomeDismissed(true)
            }}
          />
        </main>
      ) : (
        <>
          <Toolbar />

          {openPicker === 'find-replace' && editor && (
            <FindReplacePanel editor={editor} onClose={closePicker} />
          )}

          <Ruler />

          <HeaderFooterEditor
            kind="header"
            value={headerText}
            placeholder="Add a header — # for the page number"
            onChange={(text) => {
              setHeader(text)
              markDirty()
            }}
          />

          <div className="flex min-h-0 flex-1">
            <OutlinePanel />
            <main className="min-h-0 flex-1">
              <EditorSurface />
            </main>
          </div>

          <HeaderFooterEditor
            kind="footer"
            value={footerText}
            placeholder="Add a footer — # for the page number"
            onChange={(text) => {
              setFooter(text)
              markDirty()
            }}
          />

          <FootnotesPanel />
          <StatusBar />
        </>
      )}

      <CommandPalette />
      <FormatPickers />

      {openPicker === 'page-numbers' && (
        <PageNumbersDialog
          section={section}
          onApply={(next) => {
            setSection(next)
            markDirty()
          }}
          onClose={closePicker}
        />
      )}

      {openPicker === 'page-setup' && (
        <PageSetupDialog
          section={section}
          onApply={(next) => {
            setSection(next)
            // Page setup is part of the document, unlike zoom.
            markDirty()
          }}
          onClose={closePicker}
        />
      )}

      {openPicker === 'settings' && <SettingsDialog onClose={closePicker} />}

      {closeGuard.prompting && (
        <ConfirmDialog
          title={t('close.title')}
          message={t('close.message', { name: windowTitle({ path, dirty: false }) })}
          onCancel={() => {
            closeGuard.resolve('cancel')
          }}
          choices={[
            {
              label: t('close.dontSave'),
              danger: true,
              onChoose: () => {
                closeGuard.resolve('discard')
              },
            },
            {
              label: t('close.cancel'),
              onChoose: () => {
                closeGuard.resolve('cancel')
              },
            },
            {
              label: t('close.save'),
              primary: true,
              onChoose: () => {
                closeGuard.resolve('save')
              },
            },
          ]}
        />
      )}
    </div>
  )
}

export function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  )
}
