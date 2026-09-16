import type { OpenSession } from './file-operations'

/**
 * The open document's package.
 *
 * Deliberately module state rather than React state or the Zustand store: for a
 * DOCX or ODT this holds binary buffers that nothing renders, and putting it in
 * a store would make every save re-render the app. The store holds the metadata;
 * this holds the bytes.
 */

let current: OpenSession | null = null

export function setSession(session: OpenSession | null): void {
  current = session
}

export function getSession(): OpenSession | null {
  return current
}
