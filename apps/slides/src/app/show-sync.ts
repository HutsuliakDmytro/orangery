import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { useShowStore } from '../store/show-store'

/**
 * Keeps the show window and the presenter view on the same slide.
 *
 * Two windows, two stores, one show. Whichever one is acted on says where the
 * show now is, and the other follows; the flag stops that from coming straight
 * back as an echo, which would be a loop that never settles.
 *
 * Outside Tauri there is one window and nothing to keep in step, so this does
 * nothing at all.
 */

let applying = false

interface ShowMoved {
  at: number | null
  blank: 'black' | 'white' | null
}

export function useShowSync(): void {
  useEffect(() => {
    if (!isTauri()) return

    // One object rather than two variables: the effect may be torn down while
    // the listener is still being set up, and the teardown has to be able to
    // say so to code that has not run yet.
    const live: { stop: (() => void) | null; cancelled: boolean } = {
      stop: null,
      cancelled: false,
    }

    void (async () => {
      const { emit, listen } = await import('@tauri-apps/api/event')

      const unlisten = await listen<ShowMoved>('show:moved', (event) => {
        applying = true
        try {
          const show = useShowStore.getState()
          if (event.payload.at === null) show.end()
          else {
            show.go(event.payload.at)
            show.setBlank(event.payload.blank)
          }
        } finally {
          applying = false
        }
      })

      const unsubscribe = useShowStore.subscribe((state, previous) => {
        if (applying) return
        if (state.at === previous.at && state.blank === previous.blank) return

        void emit('show:moved', { at: state.at, blank: state.blank })
      })

      if (live.cancelled) {
        unlisten()
        unsubscribe()
        return
      }

      live.stop = () => {
        unlisten()
        unsubscribe()
      }
    })()

    return () => {
      live.cancelled = true
      live.stop?.()
    }
  }, [])
}
