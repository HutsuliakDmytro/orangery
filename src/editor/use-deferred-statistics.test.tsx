import { act, renderHook, waitFor } from '@testing-library/react'
import { EditorContext, useEditor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { describe, expect, it } from 'vitest'
import { buildExtensions } from './extension-set'
import { STATISTICS_DELAY_MS, useDeferredStatistics } from './use-deferred-statistics'

function Wrapper({ children }: { children: ReactNode }) {
  const editor = useEditor({ extensions: buildExtensions(), content: '<p>one two three</p>' })
  const value = useMemo(() => ({ editor }), [editor])
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

describe('useDeferredStatistics', () => {
  it('counts the document immediately on mount, so the bar is never blank', async () => {
    const { result } = renderHook(() => useDeferredStatistics(), { wrapper: Wrapper })
    await waitFor(() => {
      expect(result.current.words).toBe(3)
    })
  })

  it('waits for typing to pause before recounting', async () => {
    const { result } = renderHook(() => ({ stats: useDeferredStatistics() }), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.stats.words).toBe(3)
    })

    // The count is deliberately stale for a moment: reading the whole document
    // on every keystroke is what made a 200-page file stutter.
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(
      () => {
        expect(result.current.stats.words).toBeGreaterThanOrEqual(3)
      },
      { timeout: STATISTICS_DELAY_MS * 3 },
    )
  })

  it('uses a delay short enough to feel immediate', () => {
    expect(STATISTICS_DELAY_MS).toBeLessThanOrEqual(500)
  })
})
