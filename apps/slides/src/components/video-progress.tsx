import { useViewStore } from '../store/view-store'

/**
 * How far along the film is, and the way out of it.
 *
 * A recording runs in real time, so a deck of forty slides is a command that
 * appears to do nothing for several minutes. One that says nothing is one
 * people press again — and the second press would record a second film.
 *
 * Stopping keeps what has been recorded rather than throwing it away: somebody
 * who stops at slide thirty of forty usually wants the thirty.
 */
export function VideoProgress() {
  const progress = useViewStore((state) => state.recordingVideo)
  const stop = useViewStore((state) => state.setRecordingVideo)

  if (progress === null) return null

  return (
    <div
      role="status"
      aria-label="Recording video"
      className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs"
    >
      <span className="text-text">
        {`Recording slide ${String(progress.at + 1)} of ${String(progress.of)}.`}
      </span>
      <span className="text-muted">This runs at the speed the deck plays at.</span>

      <button
        type="button"
        onClick={() => {
          stop(null)
        }}
        className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-muted"
      >
        Stop
      </button>
    </div>
  )
}
