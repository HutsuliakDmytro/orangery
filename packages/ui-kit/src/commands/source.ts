import { createContext, useContext } from 'react'
import type { CommandContext } from './types'

/**
 * Where the chrome gets the context to run a command against, and how it knows
 * that context has changed.
 *
 * The registry itself is a plain module, but a toolbar button has to grey
 * itself out the moment the selection moves, and only the app knows what to
 * watch for that. So the app supplies both halves: read the context now, and
 * call me when the answer may differ.
 *
 * `subscribe` is what keeps a button re-rendering on its own state rather than
 * on every keystroke — the hook compares the two booleans it cares about and
 * ignores the rest (CLAUDE.md: large documents stay responsive).
 */
export interface CommandSource {
  /** The context as of now, or null while there is nothing to act on yet. */
  read: () => CommandContext | null
  /** Registers a listener called whenever `read` may return something new. */
  subscribe: (listener: () => void) => () => void
}

export const SourceContext = createContext<CommandSource | null>(null)

/** Null outside a provider, which is what a surface rendered before the app is ready sees. */
export function useCommandSource(): CommandSource | null {
  return useContext(SourceContext)
}
