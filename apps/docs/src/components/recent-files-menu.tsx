import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { RecentFilesMenu as Menu } from '@orangery/ui-kit'
import { loadRecentFiles } from '@orangery/platform'
import type { RecentFile } from '@orangery/platform'
import { fileOperations } from '../editor/commands/file-actions'
import { useDocumentStore } from '../store/document-store'

/**
 * File → Open Recent, as a dropdown in the title bar until the toolbar exists
 * (Phase 3). The list is re-read whenever a document is opened or saved, so it
 * reflects what the store just recorded.
 */
export function RecentFilesMenu() {
  const { editor } = useCurrentEditor()
  const path = useDocumentStore((state) => state.path)
  const lastSaved = useDocumentStore((state) => state.lastSaved)
  const [files, setFiles] = useState<RecentFile[]>([])

  useEffect(() => {
    void (async () => {
      setFiles(await loadRecentFiles())
    })()
  }, [path, lastSaved])

  return (
    <Menu
      files={files}
      onPick={(picked) => {
        if (editor) void fileOperations.open(editor, picked)
      }}
    />
  )
}
