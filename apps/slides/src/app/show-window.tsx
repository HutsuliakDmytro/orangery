import { useEffect, useState } from 'react'
import { readDeckFile } from '../document/file'
import { closeShowWindows, showSource } from '../document/show-windows'
import { Presenter } from '../components/presenter'
import { Show } from '../components/show'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'
import { useShowSync } from './show-sync'
import { useTheme } from './use-theme'

/**
 * A window that holds nothing but the show, or nothing but the presenter view.
 *
 * It loads the deck itself, from the copy the editor wrote out, rather than
 * being handed one: a window reloaded mid-show then comes back to the same
 * place, and there is one way a deck gets into a window rather than two.
 */
export function ShowWindow({ presenter }: { presenter: boolean }) {
  const [problem, setProblem] = useState<string | null>(null)
  const at = useShowStore((state) => state.at)

  useTheme()
  useShowSync()

  useEffect(() => {
    void (async () => {
      try {
        const source = await showSource()
        if (source === null) {
          setProblem('This window was opened without a show to give it.')
          return
        }

        const bytes = await readDeckFile(source.path)
        await useDeckStore.getState().load(bytes, null)

        const count = useDeckStore.getState().open?.deck.slides.length ?? 0
        useShowStore.getState().start(source.at, count)
      } catch (cause) {
        setProblem(cause instanceof Error ? cause.message : 'The show could not be opened.')
      }
    })()
  }, [])

  // Ending the show closes both windows, from whichever one ended it.
  const started = at !== null
  useEffect(() => {
    if (started || problem !== null) return
    void closeShowWindows()
  }, [started, problem])

  if (problem !== null) {
    return (
      <div className="flex h-full items-center justify-center bg-black p-8">
        <p role="alert" className="max-w-md text-center text-sm text-white/70">
          {problem}
        </p>
      </div>
    )
  }

  return presenter ? <Presenter /> : <Show />
}
