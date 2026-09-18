import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'

/**
 * Timing a run, and keeping the numbers.
 *
 * The clock is the real one with the time held still, because what is being
 * tested is the arithmetic of "how long was this slide up" and not whether the
 * machine can count seconds.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

let now = 1_000_000

/**
 * A recorder that produces four bytes.
 *
 * jsdom has none, and neither has any machine running these tests without a
 * microphone — which is also the case the code has to answer for, so the stub
 * is the only way to reach the path where there *is* one.
 */
class StubRecorder {
  state = 'recording'
  mimeType = 'audio/mp4'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])]) })
    this.onstop?.()
  }
}

beforeEach(async () => {
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)

  useDeckStore.getState().close()
  useShowStore.getState().end()

  const bytes = await readFile(join(FIXTURES, 'many-slides.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/many.pptx')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Moves the clock on, as a person talking would. */
const after = (seconds: number) => {
  now += seconds * 1000
}

const partText = (index: number) => {
  const { open } = useDeckStore.getState()
  const slide = open?.deck.slides[index]
  return open == null || slide === undefined ? '' : (getPartText(open.package, slide.path) ?? '')
}

describe('timing a run', () => {
  it('counts the time each slide was up', () => {
    render(<App />)
    act(() => {
      runCommand('show.rehearse', {})
    })

    after(10)
    act(() => {
      useShowStore.getState().next()
    })
    after(4)
    act(() => {
      useShowStore.getState().end()
    })

    const spent = useShowStore.getState().spent
    expect(Math.round((spent[0] ?? 0) / 1000)).toBe(10)
    expect(Math.round((spent[1] ?? 0) / 1000)).toBe(4)
  })

  it('counts the slide that was up when the run ended', () => {
    // A run that stopped the clock at the last change would lose the whole of
    // the last slide.
    render(<App />)
    act(() => {
      runCommand('show.rehearse', {})
    })
    after(7)
    act(() => {
      useShowStore.getState().end()
    })

    expect(Math.round((useShowStore.getState().spent[0] ?? 0) / 1000)).toBe(7)
  })

  it('adds up a slide gone back to rather than replacing its time', () => {
    render(<App />)
    act(() => {
      runCommand('show.rehearse', {})
    })

    after(5)
    act(() => {
      useShowStore.getState().go(1)
    })
    after(3)
    act(() => {
      useShowStore.getState().go(0)
    })
    after(6)
    act(() => {
      useShowStore.getState().end()
    })

    // Talked about twice; the two together are how long it took.
    expect(Math.round((useShowStore.getState().spent[0] ?? 0) / 1000)).toBe(11)
  })
})

describe('what is offered afterwards', () => {
  it('shows the run, slide by slide', () => {
    render(<App />)
    act(() => {
      runCommand('show.rehearse', {})
    })
    after(6)
    act(() => {
      useShowStore.getState().end()
    })

    expect(screen.getByRole('dialog', { name: 'Rehearsal' })).toBeInTheDocument()
    expect(screen.getByText('0:06')).toBeInTheDocument()
  })

  it('offers nothing after an ordinary show', () => {
    // Every run is timed, because the presenter wants to know how long they
    // have been on this slide. Only a rehearsal was started to make numbers.
    render(<App />)
    act(() => {
      runCommand('show.start', {})
    })
    after(6)
    act(() => {
      useShowStore.getState().end()
    })

    expect(screen.queryByRole('dialog', { name: 'Rehearsal' })).not.toBeInTheDocument()
  })

  it('writes the timings into the deck when they are kept', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    act(() => {
      runCommand('show.rehearse', {})
    })
    after(8)
    act(() => {
      useShowStore.getState().end()
    })

    await user.click(screen.getByRole('button', { name: 'Keep timings' }))

    expect(partText(0)).toContain('advTm="8000"')
    // The timing and nothing else: a deck that started dissolving because it
    // was practised would be a deck changed by being practised.
    expect(partText(0)).not.toContain('p:fade')
  })

  it('leaves the deck alone when they are discarded', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)
    act(() => {
      runCommand('show.rehearse', {})
    })
    after(8)
    act(() => {
      useShowStore.getState().end()
    })

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(partText(0)).not.toContain('advTm')
    expect(useDeckStore.getState().saved).toBe(true)
  })
})

describe('recording a run', () => {
  /** A recorder that produces four bytes and says it is MP4. */
  function stubRecorder() {
    const tracks = [{ stop: () => undefined }]
    vi.stubGlobal('MediaRecorder', StubRecorder)
    // Only what the recorder asks for: spreading the real navigator would
    // lose it, and nothing else here reaches for one.
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => tracks }) },
    })
  }

  it('is offered as a command of its own', () => {
    render(<App />)
    expect(getCommand('show.record')).toBeDefined()
  })

  it('records a piece for each slide and keeps it on that slide', async () => {
    stubRecorder()
    const user = userEvent.setup({ advanceTimers: () => undefined })
    render(<App />)

    act(() => {
      runCommand('show.record', {})
    })
    // Let the microphone be granted before the slide changes.
    await act(async () => {
      await Promise.resolve()
    })

    after(5)
    await act(async () => {
      useShowStore.getState().next()
      await Promise.resolve()
    })
    after(5)
    await act(async () => {
      useShowStore.getState().end()
      await Promise.resolve()
    })

    await user.click(await screen.findByRole('button', { name: /Keep timings/u }))

    // A sound on each of the two slides that were talked over.
    expect(partText(0)).toContain('a:audioFile')
    expect(partText(1)).toContain('a:audioFile')
  })

  it('goes on without a microphone rather than refusing to start', async () => {
    // A show that did not happen because the microphone was busy is worse than
    // a show with no narration in it.
    vi.stubGlobal('MediaRecorder', undefined)
    render(<App />)

    act(() => {
      runCommand('show.record', {})
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(useShowStore.getState().at).toBe(0)
  })
})
