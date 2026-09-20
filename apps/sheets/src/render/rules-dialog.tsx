import { useState } from 'react'
import { LOOKS, ruleSaid } from '../document/rules'
import type { LookName, RuleKind } from '../document/rules'
import type { ConditionalRule } from '@orangery/ooxml-spreadsheet'

/**
 * The rules on the cell the cursor is in, and a way to make another.
 *
 * Excel's dialog is a wizard of five pages; this is one, because the rules
 * people actually make are "colour this if it is over that". Everything else
 * a file can carry is shown in the list and left alone — a colour scale
 * somebody made in Excel is listed as a colour scale and can be removed,
 * which is more use than a dialog that pretends it is not there.
 */

export interface RulesDialogProps {
  rules: readonly ConditionalRule[]
  onAdd: (asked: { kind: RuleKind; first: string; second: string; look: LookName }) => void
  onRemove: (rule: ConditionalRule) => void
  onClose: () => void
}

const KINDS: { kind: RuleKind; label: string; operands: number }[] = [
  { kind: 'greaterThan', label: 'Greater than', operands: 1 },
  { kind: 'lessThan', label: 'Less than', operands: 1 },
  { kind: 'between', label: 'Between', operands: 2 },
  { kind: 'equal', label: 'Equal to', operands: 1 },
  { kind: 'containsText', label: 'Text contains', operands: 1 },
  { kind: 'duplicateValues', label: 'Duplicate values', operands: 0 },
]

export function RulesDialog({ rules, onAdd, onRemove, onClose }: RulesDialogProps) {
  const [kind, setKind] = useState<RuleKind>('greaterThan')
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [look, setLook] = useState<LookName>('red')

  const chosen = KINDS.find((one) => one.kind === kind) ?? KINDS[0]
  const operands = chosen?.operands ?? 1
  const ready = operands === 0 || (first.trim() !== '' && (operands < 2 || second.trim() !== ''))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conditional formatting"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-[30rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs">
        <h2 className="text-sm">Conditional formatting</h2>

        <ul className="max-h-48 overflow-auto rounded border border-border">
          {rules.length === 0 && <li className="px-2 py-2 text-muted">No rules on this cell.</li>}
          {rules.map((rule, at) => (
            <li
              key={`${rule.type}-${String(rule.priority)}-${String(at)}`}
              className="flex items-baseline gap-2 border-b border-border px-2 py-1 last:border-b-0"
            >
              <span className="flex-1 truncate">{ruleSaid(rule)}</span>
              <button
                type="button"
                aria-label={`Delete rule ${String(at + 1)}`}
                className="text-muted hover:text-fg"
                onClick={() => {
                  onRemove(rule)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) onAdd({ kind, first, second, look })
          }}
        >
          <select
            aria-label="Rule"
            value={kind}
            className="h-6 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
            onChange={(event) => {
              setKind(event.target.value as RuleKind)
            }}
          >
            {KINDS.map((one) => (
              <option key={one.kind} value={one.kind}>
                {one.label}
              </option>
            ))}
          </select>

          {operands > 0 && (
            <input
              aria-label="Value"
              value={first}
              spellCheck={false}
              className="h-6 w-24 rounded border border-border bg-surface px-1 font-mono outline-none focus:border-accent"
              onChange={(event) => {
                setFirst(event.target.value)
              }}
            />
          )}
          {operands > 1 && (
            <input
              aria-label="Second value"
              value={second}
              spellCheck={false}
              className="h-6 w-24 rounded border border-border bg-surface px-1 font-mono outline-none focus:border-accent"
              onChange={(event) => {
                setSecond(event.target.value)
              }}
            />
          )}

          <select
            aria-label="Colour"
            value={look}
            className="h-6 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
            onChange={(event) => {
              setLook(event.target.value as LookName)
            }}
          >
            {Object.keys(LOOKS).map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={!ready}
            className="h-6 rounded border border-border px-2 disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <div className="flex justify-end">
          <button type="button" className="h-6 rounded bg-accent px-2 text-white" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
