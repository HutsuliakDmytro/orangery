import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { loadRecentFiles } from '../document/recent-files'
import type { RecentFile } from '../document/recent-files'
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
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      setFiles(await loadRecentFiles())
    })()
  }, [path, lastSaved])

  if (files.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-border px-2 py-0.5 text-xs text-muted"
      >
        Recent
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded border border-border bg-surface shadow-xl"
        >
          {files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                role="menuitem"
                title={file.path}
                onClick={() => {
                  setOpen(false)
                  if (editor) void fileOperations.open(editor, file.path)
                }}
                className="w-full truncate px-3 py-1.5 text-left text-xs text-text"
              >
                {file.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
