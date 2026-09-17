import type { Editor } from '@tiptap/core'
import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { computeStatistics } from './statistics'
import type { DocumentStatistics } from './statistics'

/**
 * Word and character counts, computed after typing pauses.
 *
 * Counting means reading the whole document's text, which on a 200-page file
 * measures ~45 ms. Doing that inside the transaction handler puts that cost on
 * every keystroke and the editor visibly stutters. The count is not information
 * anyone reads mid-word, so it is deferred until the user stops.
 */

export const STATISTICS_DELAY_MS = 400

const EMPTY: DocumentStatistics = {
  words: 0,
  characters: 0,
  charactersWithoutSpaces: 0,
  pages: 1,
}

export function useDeferredStatistics(): DocumentStatistics {
  const { editor } = useCurrentEditor()
  const [statistics, setStatistics] = useState<DocumentStatistics>(EMPTY)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!editor) return

    const recompute = (instance: Editor) => {
      setStatistics(computeStatistics(instance.getText({ blockSeparator: '\n' })))
    }

    const schedule = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        recompute(editor)
      }, STATISTICS_DELAY_MS)
    }

    // The first count is immediate so the bar is not blank on open.
    recompute(editor)

    editor.on('update', schedule)
    return () => {
      editor.off('update', schedule)
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [editor])

  return statistics
}
