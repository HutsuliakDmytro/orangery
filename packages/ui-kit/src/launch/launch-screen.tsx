import { FileWarning, FolderOpen } from 'lucide-react'
import { dismissLaunchFailure, fileNameOf, useLaunchState } from './use-launch-requests'

/**
 * What a window shows in place of the welcome screen while it is not the
 * welcome screen's turn.
 *
 * Three states, and only one of them has anything in it. While Rust has not
 * answered, nothing: a blank page for a few milliseconds is invisible, and the
 * welcome screen flashing up before the file is not. While a file opens, its
 * name. And when it would not open, why — in the window the person is looking
 * at, because a double-click that produces an empty welcome screen reads as
 * the app ignoring them.
 *
 * `null` when the welcome screen should be shown, so a caller can write
 * `<LaunchScreen …/> ?? <Welcome/>` in effect without knowing the states.
 */
export function LaunchScreen({
  appName,
  onOpenAnother,
}: {
  /** "Orangery Docs", for the sentence about what this app opens. */
  appName: string
  /** The app's own Open dialog. */
  onOpenAnother: () => void
}) {
  const { settled, opening, failure } = useLaunchState()

  if (opening !== null) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <p className="text-sm text-muted" role="status">
          Opening {fileNameOf(opening)}…
        </p>
      </div>
    )
  }

  if (!settled) return <div className="h-full bg-bg" aria-busy="true" />

  if (failure === null) return null

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div
        role="alert"
        className="w-[min(520px,100%)] rounded-lg border border-border bg-surface p-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <FileWarning size={20} strokeWidth={1.5} aria-hidden className="text-danger" />
          <h1 className="text-base font-medium text-text">
            {appName} could not open “{fileNameOf(failure.path)}”
          </h1>
        </div>

        <p className="mb-3 text-sm text-text">{failure.message}</p>
        <p className="mb-5 break-all font-mono text-xs text-muted">{failure.path}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={dismissLaunchFailure}
            className="rounded border border-border px-3 py-1 text-sm text-text"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              dismissLaunchFailure()
              onOpenAnother()
            }}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-sm text-black"
          >
            <FolderOpen size={14} aria-hidden />
            Open Another…
          </button>
        </div>
      </div>
    </div>
  )
}
