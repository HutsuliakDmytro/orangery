import { useMemo } from 'react'
import type { CommandSource } from '@orangery/ui-kit'
import { useWorkbookStore } from '../store/workbook-store'

/**
 * What a Sheets command acts on, and when to ask again.
 *
 * The context is empty — a command reads the store it needs — but the second
 * half matters from the first day: whether a command can run at all depends on
 * whether a workbook is open, and without a notification the menu would show
 * the state the app started in for as long as it stayed open.
 */
export function useCommandSource(): CommandSource {
  return useMemo(
    () => ({
      read: () => ({}),
      subscribe: (listener) => useWorkbookStore.subscribe(listener),
    }),
    [],
  )
}
