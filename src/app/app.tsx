import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { sectionAt } from '../editor/sections'
import { readSectionHeaders, writeSectionHeaders } from '../document/section-headers'
import type { HeaderFooterSlot } from '../store/header-footer-store'
import { serializeSection } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandPalette } from '../components/command-palette'
import { ConfirmDialog } from '../components/confirm-dialog'
import { FindReplacePanel } from '../components/find-replace-panel'
import { FootnotesPanel } from '../components/footnotes-panel'
import { HeaderFooterEditor } from '../components/header-footer-editor'
import { FormatPickers } from '../components/format-pickers'
import { CommentsPanel } from '../components/comments-panel'
import { OutlinePanel } from '../components/outline-panel'
import { PageNumbersDialog } from '../components/page-numbers-dialog'
import { PageSetupDialog } from '../components/page-setup-dialog'
import { RecentFilesMenu } from '../components/recent-files-menu'
import { RecoveryBanner } from '../components/recovery-banner'
import { Ruler } from '../components/ruler'
import { SettingsDialog } from '../components/settings-dialog'
import { StylesPanel } from '../components/styles-panel'
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
  const headerFooter = useHeaderFooterStore()
  const loadHeaderFooter = useHeaderFooterStore((state) => state.load)
  const setSection = useViewStore((state) => state.setSection)

  /**
   * The page setup where the cursor is, and how to change it.
   *
   * A document can hold several sections, and the one being edited is the one
   * the cursor sits in — the body holds only the last. Changing an earlier one
   * writes back to the break that ends it, which is where OOXML keeps it.
   */
  const currentSection = useEditorState({
    editor: editor ?? null,
    // Subscribed to rather than read while rendering: nothing else re-renders
    // the app when the cursor crosses into another section, and the header
    // fields would go on showing the one it left.
    selector: ({ editor: instance }) =>
      instance
        ? sectionAt(instance.state.doc, instance.state.selection.from, section)
        : { from: 0, to: 0, breakPosition: null, properties: section },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }) ?? { from: 0, to: 0, breakPosition: null, properties: section }

  /**
   * The header and footer text of the section the cursor is in.
   *
   * Read straight from the package whenever the store is holding another
   * section's, rather than loaded by an effect: an effect runs after the render
   * that moved the cursor, and in that gap the fields show one section while
   * an edit would be written to it — which is the whole bug this avoids.
   */
  const sectionKey = currentSection.breakPosition
  const session = getSession()
  const packaged = session?.kind === 'docx' ? session.docx.pkg : null

  const headerValues =
    headerFooter.sectionKey === sectionKey || packaged === null
      ? headerFooter
      : readSectionHeaders(packaged, currentSection.properties)

  /**
   * Writes the page setup of one section back where that section keeps it.
   *
   * Identified by the break that ends it, or by nothing for the one the body
   * holds — the same key the header fields are loaded against.
   */
  const applyToSection = (key: number | null, next: SectionProperties) => {
    if (!editor || key === null) {
      setSection(next)
      return
    }

    const node = editor.state.doc.nodeAt(key)
    if (!node) return

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(key, undefined, {
        ...node.attrs,
        sectPr: serializeSection(next),
      }),
    )
  }

  const changeHeaderFooter = (slot: HeaderFooterSlot, text: string) => {
    markDirty()
    if (packaged === null || !editor) return

    // Worked out now rather than taken from the render: an edit can arrive
    // before React has re-rendered for the click that moved the cursor, and the
    // section from that render is the one the cursor has just left.
    const live = sectionAt(editor.state.doc, editor.state.selection.from, section)

    // Built on that section's own values, so nothing of the section being
    // shown a moment ago can be carried into it.
    const values = { ...readSectionHeaders(packaged, live.properties), [slot]: text }

    loadHeaderFooter(values, live.breakPosition)
    applyToSection(live.breakPosition, writeSectionHeaders(packaged, live.properties, values))
  }

  const applySection = (next: SectionProperties) => {
    applyToSection(currentSection.breakPosition, next)
    // Page setup is part of the document, unlike zoom.
    markDirty()
  }

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
            value={headerValues.header}
            placeholder="Add a header — # for the page number"
            onChange={(text) => {
              changeHeaderFooter('header', text)
            }}
          />

          {/* The opening page gets a pair of its own only where the section
              sets that page apart; otherwise there is nothing there to edit. */}
          {currentSection.properties.differentFirstPage && (
            <HeaderFooterEditor
              kind="header"
              label="First page"
              value={headerValues.firstHeader}
              placeholder="Header for the first page only"
              onChange={(text) => {
                changeHeaderFooter('firstHeader', text)
              }}
            />
          )}

          <div className="flex min-h-0 flex-1">
            <OutlinePanel />
            <main className="min-h-0 flex-1">
              <EditorSurface />
            </main>
            <CommentsPanel />
          </div>

          {currentSection.properties.differentFirstPage && (
            <HeaderFooterEditor
              kind="footer"
              label="First page"
              value={headerValues.firstFooter}
              placeholder="Footer for the first page only"
              onChange={(text) => {
                changeHeaderFooter('firstFooter', text)
              }}
            />
          )}

          <HeaderFooterEditor
            kind="footer"
            value={headerValues.footer}
            placeholder="Add a footer — # for the page number"
            onChange={(text) => {
              changeHeaderFooter('footer', text)
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
          section={currentSection.properties}
          onApply={applySection}
          onClose={closePicker}
        />
      )}

      {openPicker === 'page-setup' && (
        <PageSetupDialog
          section={currentSection.properties}
          onApply={applySection}
          onClose={closePicker}
        />
      )}

      {openPicker === 'styles' && <StylesPanel onClose={closePicker} />}

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
