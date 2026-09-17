import { SourceContext } from './source'
import type { CommandSource } from './source'
import type { ReactNode } from 'react'

/** Installs the context the chrome runs commands against. */
export function CommandSourceProvider({
  source,
  children,
}: {
  source: CommandSource
  children: ReactNode
}) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>
}
