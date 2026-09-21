import { useEffect, useRef, useState } from 'react'
import { startRecording } from './narration'
import type { Recording } from './narration'
import { useShowStore } from '../store/show-store'

/**
 * Recording a run, a slide at a time.
 *
 * Driven by the show store rather than by the component tree: what ends one
 * recording and starts the next is the slide changing, and that is a thing the
 * store knows about and a component only hears about afterwards.
 *
 * What comes back is what was recorded, by slide, once the run has ended.
 * Nothing is written to the deck here — keeping it is a question, and the
 * answer is asked for somewhere a person can see it.
 */
export function useNarration(): Record<number, Recording> | null {
  const [taken, setTaken] = useState<Record<number, Recording> | null>(null)
  const pieces = useRef<Record<number, Recording>>({})

  useEffect(() => {
    let recorder: Awaited<ReturnType<typeof startRecording>> = null
    let stopped = false

    const stop = useShowStore.subscribe((state, before) => {
      if (state.recording && !before.recording) {
        pieces.current = {}
        setTaken(null)
        void startRecording().then((started) => {
          if (stopped) void started?.stop()
          else recorder = started
        })
        return
      }

      // The slide changed while recording: the piece that was being made
      // belongs to the slide that was up, not to the one arriving.
      if (state.recording && before.recording && state.at !== before.at && before.at !== null) {
        const wasOn = before.at
        void recorder?.cut().then((piece) => {
          if (piece !== null) pieces.current[wasOn] = piece
        })
        return
      }

      if (!state.recording && before.recording && before.at !== null) {
        const wasOn = before.at
        void recorder?.stop().then((piece) => {
          if (piece !== null) pieces.current[wasOn] = piece
          recorder = null
          setTaken({ ...pieces.current })
        })
      }
    })

    return () => {
      stopped = true
      stop()
      void recorder?.stop()
    }
  }, [])

  return taken
}
