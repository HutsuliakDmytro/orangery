import { useEffect, useState } from 'react'
import { SheetView } from '../render/sheet-view'
import { useWorkbookStore, visibleSheetsOf } from '../store/workbook-store'

/**
 * The window.
 *
 * A spreadsheet is one big surface and a strip of tabs, and almost everything
 * a person does happens on the surface. What is around it — the toolbar, the
 * formula bar, the name box — comes with the editing phases; until then the
 * window is what a reader needs, which is the sheet itself.
 */
export function App() {
  const open = useWorkbookStore((state) => state.open)
  const current = useWorkbookStore((state) => state.current)
  const select = useWorkbookStore((state) => state.select)
  const size = useWindowSize()

  const sheets = open === null ? [] : visibleSheetsOf(open)
  const sheet = sheets[current] ?? null

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <main className="min-h-0 flex-1">
        {sheet === null || open === null ? (
          <p className="p-4 text-sm text-muted">No workbook open</p>
        ) : (
          <SheetView
            open={open}
            sheet={sheet}
            width={size.width}
            height={Math.max(size.height - 32, 120)}
          />
        )}
      </main>

      {sheets.length > 0 && (
        <nav aria-label="Sheets" className="flex h-8 items-stretch gap-px border-t border-border">
          {sheets.map((one, index) => (
            <button
              key={one.path}
              type="button"
              aria-current={index === current}
              onClick={() => {
                select(index)
              }}
              className={`px-3 text-xs ${
                index === current
                  ? 'border-b-2 border-accent text-text'
                  : 'text-muted hover:text-text'
              }`}
            >
              {one.name}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

/**
 * The window's size, which the grid needs in numbers.
 *
 * A canvas cannot be told to fill its parent — it has to be given a width and
 * a height in pixels — so the one thing the shell measures is the window.
 */
function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    const onResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return size
}
