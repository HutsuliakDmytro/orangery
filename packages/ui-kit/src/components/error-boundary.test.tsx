import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './error-boundary'

/**
 * What stands between a thrown error and a black window.
 *
 * React unmounts the whole tree when a render throws and nothing catches it:
 * the window stays open, says nothing, and goes to the background colour. This
 * is the component that turns that into a sentence somebody can read and a
 * string somebody can paste into a bug report.
 */

const Throws = ({ what }: { what: string }) => {
  throw new Error(what)
}

beforeEach(() => {
  // React writes the caught error to the console itself, and so does the
  // boundary. Neither is a failure of this test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a render that threw', () => {
  it('says so rather than showing nothing at all', () => {
    render(
      <ErrorBoundary>
        <Throws what="a chart nobody could draw" />
      </ErrorBoundary>,
    )

    expect(screen.queryByRole('alert')).not.toBeNull()
    expect(screen.queryByText(/would not draw/u)).not.toBeNull()
  })

  it('shows what threw, because "it went black" is not a bug report', () => {
    render(
      <ErrorBoundary>
        <Throws what="a chart nobody could draw" />
      </ErrorBoundary>,
    )

    expect(screen.queryByText(/a chart nobody could draw/u)).not.toBeNull()
  })

  it('says the file is untouched, which is the question somebody has', () => {
    render(
      <ErrorBoundary>
        <Throws what="anything" />
      </ErrorBoundary>,
    )

    expect(screen.queryByText(/has not been changed/u)).not.toBeNull()
  })

  it('puts the details on the clipboard, where a bug report can reach them', () => {
    const written = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: written } })

    render(
      <ErrorBoundary>
        <Throws what="a chart nobody could draw" />
      </ErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy the details' }))

    expect(written).toHaveBeenCalledWith(expect.stringContaining('a chart nobody could draw'))
  })

  it('lets go of the error when asked to try again', () => {
    let thrown = true
    const Sometimes = () => {
      if (thrown) throw new Error('the first time')
      return <p>drawn</p>
    }

    render(
      <ErrorBoundary>
        <Sometimes />
      </ErrorBoundary>,
    )

    thrown = false
    fireEvent.click(screen.getByRole('button', { name: 'Try drawing it again' }))

    expect(screen.queryByText('drawn')).not.toBeNull()
  })
})

describe('a render that did not throw', () => {
  it('is left entirely alone', () => {
    render(
      <ErrorBoundary>
        <p>the window</p>
      </ErrorBoundary>,
    )

    expect(screen.queryByText('the window')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
