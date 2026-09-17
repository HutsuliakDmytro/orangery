import { useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'

/**
 * The drag-a-grid table picker, as in Word and Docs.
 *
 * Ten by eight is what both offer; larger tables are built by adding rows and
 * columns afterwards, which is also how both behave.
 */
const MAX_COLUMNS = 10
const MAX_ROWS = 8

export function TableGridPicker({
  onPick,
  onClose,
}: {
  onPick: (size: { rows: number; cols: number }) => void
  onClose: () => void
}) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 })

  const cells = Array.from({ length: MAX_ROWS }, (_, row) =>
    Array.from({ length: MAX_COLUMNS }, (_, column) => ({ row: row + 1, col: column + 1 })),
  )

  return (
    <PickerPopover title="Insert table" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div
          role="grid"
          aria-label="Table size"
          className="flex flex-col gap-0.5"
          onMouseLeave={() => {
            setHover({ rows: 0, cols: 0 })
          }}
        >
          {cells.map((row) => (
            <div key={row[0]?.row} role="row" className="flex gap-0.5">
              {row.map((cell) => {
                const selected = cell.row <= hover.rows && cell.col <= hover.cols
                return (
                  <button
                    key={cell.col}
                    type="button"
                    role="gridcell"
                    aria-label={`${String(cell.row)} by ${String(cell.col)}`}
                    aria-selected={selected}
                    onMouseEnter={() => {
                      setHover({ rows: cell.row, cols: cell.col })
                    }}
                    onFocus={() => {
                      setHover({ rows: cell.row, cols: cell.col })
                    }}
                    onClick={() => {
                      onPick({ rows: cell.row, cols: cell.col })
                      onClose()
                    }}
                    className={`h-4 w-4 rounded-[2px] border ${
                      selected ? 'border-accent bg-accent-soft' : 'border-border'
                    }`}
                  />
                )
              })}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted" aria-live="polite">
          {hover.rows === 0 ? 'Choose a size' : `${String(hover.rows)} × ${String(hover.cols)}`}
        </p>
      </div>
    </PickerPopover>
  )
}
