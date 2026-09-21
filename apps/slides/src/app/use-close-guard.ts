import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { whenSafe } from '../document/unsaved'

/**
 * Catches the window being closed while a deck has unsaved changes.
 *
 * Rust vetoes the close and says so; what to ask is decided here, because the
 * answer depends on the deck and the deck lives in the frontend. A clean deck
 * closes at once — the confirmation that appears every time is the one people
 * learn to dismiss without reading.
 */
export function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauri()) return

    const unlisten = listen('window:close-requested', () => {
      whenSafe(() => invoke('confirm_close'))
    })

    return () => {
      void unlisten.then((stop) => {
        stop()
      })
    }
  }, [])
}
