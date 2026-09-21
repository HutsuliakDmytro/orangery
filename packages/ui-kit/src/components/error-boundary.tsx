import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * The last thing between a thrown error and a black window.
 *
 * React unmounts the whole tree when a render throws and nothing catches it.
 * The window does not close and does not say anything — it goes to the
 * background colour, which in this suite is black. A person is then looking at
 * an app that has apparently stopped existing, holding a file they cannot see,
 * with nothing to report but "it went black".
 *
 * That is the worst failure this chrome can have, and it is the one that costs
 * nothing to fix: catch it, say what threw, and put the text somewhere it can
 * be copied into a bug report. The file is untouched either way — nothing here
 * has written anything — so the honest thing to say is that it is still on the
 * disk as it was.
 *
 * A class, which is the one place this codebase has one: `componentDidCatch`
 * has no hook, and React has never given it one.
 *
 * It catches what happens while rendering. A failure inside an async handler —
 * a file that would not open, a command that failed — is not a render and
 * never reaches here; those are said by the app's own banner, which is the
 * right place for them because the window still works.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  where: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, where: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as well as logged: the console of a packaged app is not somewhere
    // anybody can reach, and the component stack is the half of the answer
    // that says which part of the file was being drawn.
    this.setState({ where: info.componentStack ?? null })
    console.error('The window failed while drawing.', error, info.componentStack)
  }

  private readonly retry = (): void => {
    this.setState({ error: null, where: null })
  }

  /**
   * The details on the clipboard, and nothing thrown if there is no clipboard.
   *
   * There is not always one — an insecure context has none, whatever the types
   * say — and a crash screen is the worst place in the program to throw a
   * second error from.
   */
  private readonly copy = (report: string): void => {
    try {
      void navigator.clipboard.writeText(report).catch(() => undefined)
    } catch {
      // Nothing to do about it, and nothing worth saying.
    }
  }

  override render(): ReactNode {
    const { error, where } = this.state
    if (error === null) return this.props.children

    const report = [
      error.message,
      error.stack ?? '',
      where === null ? '' : `Component stack:${where}`,
    ]
      .filter((part) => part !== '')
      .join('\n\n')

    return (
      <div
        role="alert"
        className="flex h-full w-full flex-col gap-4 overflow-auto bg-bg p-8 text-text"
      >
        <div>
          <h1 className="text-lg font-medium">Something in this window would not draw.</h1>
          <p className="mt-1 text-sm text-muted">
            Your file has not been changed — nothing here writes to it. Close the window and it is
            still on disk as it was.
          </p>
        </div>

        <pre className="max-h-96 overflow-auto rounded border border-border bg-surface p-3 text-xs whitespace-pre-wrap text-muted">
          {report}
        </pre>

        <div className="flex gap-3 text-sm">
          <button
            type="button"
            className="rounded border border-border px-3 py-1 hover:border-accent"
            onClick={() => {
              this.copy(report)
            }}
          >
            Copy the details
          </button>
          <button
            type="button"
            className="rounded border border-border px-3 py-1 hover:border-accent"
            onClick={this.retry}
          >
            Try drawing it again
          </button>
        </div>
      </div>
    )
  }
}
