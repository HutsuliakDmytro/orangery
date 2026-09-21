import { useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'
import { insertTableOnSlide } from '../document/insert-table'
import { useViewStore } from '../store/view-store'

/**
 * How big a table to put on the slide.
 *
 * A grid you sweep rather than two numbers to type, which is what every program
 * with this feature does — the size is a shape you recognise rather than a pair
 * of figures you work out.
 *
 * Eight by ten because that is where PowerPoint's own grid stops. Past it,
 * pointing accurately is harder than adding rows afterwards, which is a thing
 * the table can already do.
 */

const ROWS = 8
const COLUMNS = 10

export function TablePicker() {
  const showing = useViewStore((state) => state.choosingTable)
  const setShowing = useViewStore((state) => state.setChoosingTable)
  const [over, setOver] = useState<{ rows: number; columns: number } | null>(null)

  if (!showing) return null

  const close = () => {
    setShowing(false)
    setOver(null)
  }

  return (
    <PickerPopover title="Insert Table" onClose={close}>
      <div className="space-y-2">
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${String(COLUMNS)}, 1rem)` }}
          onPointerLeave={() => {
            setOver(null)
          }}
        >
          {Array.from({ length: ROWS * COLUMNS }, (_, index) => {
            const row = Math.floor(index / COLUMNS) + 1
            const column = (index % COLUMNS) + 1
            const lit = over !== null && row <= over.rows && column <= over.columns

            return (
              <button
                key={index}
                type="button"
                aria-label={`${String(row)} by ${String(column)}`}
                onPointerEnter={() => {
                  setOver({ rows: row, columns: column })
                }}
                onClick={() => {
                  close()
                  insertTableOnSlide(row, column)
                }}
                className={`h-4 w-4 rounded-sm border ${
                  lit ? 'border-accent bg-accent-soft' : 'border-border'
                }`}
              />
            )
          })}
        </div>

        <p className="text-xs text-muted" role="status">
          {over === null
            ? 'Sweep to choose a size'
            : `${String(over.rows)} \u00d7 ${String(over.columns)}`}
        </p>
      </div>
    </PickerPopover>
  )
}
