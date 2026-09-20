import { mergeCovering, resolveColor, resolveStyle } from '@orangery/ooxml-spreadsheet'
import type { LookChange, ResolvedStyle } from '@orangery/ooxml-spreadsheet'
import type { GridSelection } from '@orangery/grid'
import type { OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * The strip of buttons above the sheet.
 *
 * One row, as Google Sheets has, rather than a ribbon: everything here is
 * something a person does dozens of times an hour, and the ones they do twice
 * a year live in the menu.
 *
 * Every button is a toggle that reads the cell the cursor is on. A toolbar
 * that did not show the state of what is selected is a toolbar you have to
 * click to find out what it would do.
 */

export interface ToolbarProps {
  open: OpenWorkbook
  sheet: OpenSheet
  selection: GridSelection
  onFormat: (look: LookChange) => void
  onMerge: (join: boolean) => void
}

/**
 * The families a workbook is likely to name.
 *
 * The names a file states rather than the ones this machine has: a cell says
 * `Calibri` whether or not Calibri is installed, and the suite ships a
 * metric-compatible family to draw it with (`packages/fonts`). Offering
 * whatever fonts happen to be on this computer would make a file that looks
 * different on the next one.
 */
const FAMILIES = [
  'Calibri',
  'Arial',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Georgia',
  'Inter',
]

/** The sizes Excel's own dropdown offers, which is the list people expect. */
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]

/**
 * What the border dropdown can do to every selected cell alike.
 *
 * A box drawn round the outside of a selection is not here: it asks for a
 * different edge on each cell of the boundary, which is a different shape of
 * change from "the same look on all of them" and wants its own way in.
 */
const EDGES: { label: string; look: LookChange }[] = [
  { label: 'All borders', look: { border: box('thin') } },
  { label: 'Bottom border', look: { border: { bottom: line('thin') } } },
  { label: 'Top border', look: { border: { top: line('thin') } } },
  { label: 'Left border', look: { border: { left: line('thin') } } },
  { label: 'Right border', look: { border: { right: line('thin') } } },
  { label: 'No borders', look: { border: box(null) } },
]

function line(style: string | null) {
  return { style, color: style === null ? null : { kind: 'rgb' as const, hex: 'FF000000' } }
}

function box(style: string | null) {
  return { left: line(style), right: line(style), top: line(style), bottom: line(style) }
}

/** The formats the dropdown offers, in the order a person meets them. */
const FORMATS: { label: string; code: string | null }[] = [
  { label: 'Automatic', code: 'General' },
  { label: 'Number', code: '#,##0.00' },
  { label: 'Percent', code: '0.00%' },
  { label: 'Date', code: 'yyyy-mm-dd' },
  { label: 'Time', code: 'h:mm:ss' },
  { label: 'Text', code: '@' },
  { label: 'Custom…', code: null },
]

export function Toolbar({ open, sheet, selection, onFormat, onMerge }: ToolbarProps) {
  const cell = sheet.cells.rows.get(selection.active.row)?.get(selection.active.column) ?? null
  const style: ResolvedStyle | null =
    open.styles === null ? null : resolveStyle(open.styles, cell?.style ?? null)

  const hex = (color: Parameters<typeof resolveColor>[0], fallback: string) => {
    const six = color === null ? null : resolveColor(color, open.palette)
    return six === null ? fallback : `#${six.length === 8 ? six.slice(2) : six}`
  }

  // Whether the cursor is in a merge, which is what turns the button into an
  // unmerge: one button, two meanings, as every spreadsheet has it.
  const merged = mergeCovering(sheet.sheet.merges, selection.active) !== null

  const fill = style?.fill
  const filled =
    fill !== null && fill !== undefined && fill.pattern !== null && fill.pattern !== 'none'

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex h-9 items-center gap-1 border-b border-border px-2"
    >
      <Toggle
        label="Bold"
        on={style?.font?.bold === true}
        onClick={() => {
          onFormat({ font: { bold: style?.font?.bold !== true } })
        }}
      >
        <span className="font-bold">B</span>
      </Toggle>

      <Toggle
        label="Italic"
        on={style?.font?.italic === true}
        onClick={() => {
          onFormat({ font: { italic: style?.font?.italic !== true } })
        }}
      >
        <span className="italic">I</span>
      </Toggle>

      <Toggle
        label="Underline"
        on={style?.font?.underline !== null && style?.font?.underline !== undefined}
        onClick={() => {
          onFormat({ font: { underline: style?.font?.underline == null ? 'single' : null } })
        }}
      >
        <span className="underline">U</span>
      </Toggle>

      <Chooser
        label="Font"
        value={style?.font?.name ?? ''}
        options={FAMILIES.map((one) => ({ label: one, value: one }))}
        onPick={(value) => {
          onFormat({ font: { name: value } })
        }}
      />
      <Chooser
        label="Font size"
        value={style?.font?.size === null ? '' : String(style?.font?.size ?? '')}
        options={SIZES.map((one) => ({ label: String(one), value: String(one) }))}
        onPick={(value) => {
          onFormat({ font: { size: Number(value) } })
        }}
      />

      <Divider />

      <Swatch
        label="Text colour"
        value={hex(style?.font?.color ?? null, '#111111')}
        onPick={(value) => {
          onFormat({ font: { color: { kind: 'rgb', hex: `FF${value.slice(1).toUpperCase()}` } } })
        }}
      />
      <Swatch
        label="Fill colour"
        value={filled ? hex(fill.foreground, '#FFFFFF') : '#FFFFFF'}
        onPick={(value) => {
          onFormat({ fill: { kind: 'rgb', hex: `FF${value.slice(1).toUpperCase()}` } })
        }}
      />
      <Toggle
        label="No fill"
        on={false}
        onClick={() => {
          onFormat({ fill: null })
        }}
      >
        <span aria-hidden>⌫</span>
      </Toggle>

      <Divider />

      {(['left', 'center', 'right'] as const).map((where) => (
        <Toggle
          key={where}
          label={`Align ${where}`}
          on={style?.alignment?.horizontal === where}
          onClick={() => {
            onFormat({ alignment: { horizontal: where } })
          }}
        >
          <span aria-hidden>{where === 'left' ? '⇤' : where === 'center' ? '↔' : '⇥'}</span>
        </Toggle>
      ))}

      <Toggle
        label="Wrap text"
        on={style?.alignment?.wrapText === true}
        onClick={() => {
          onFormat({ alignment: { wrapText: style?.alignment?.wrapText !== true } })
        }}
      >
        <span aria-hidden>↵</span>
      </Toggle>

      <Toggle
        label="Merge cells"
        on={merged}
        onClick={() => {
          onMerge(!merged)
        }}
      >
        <span aria-hidden>▭</span>
      </Toggle>

      <Divider />

      <Chooser
        label="Borders"
        value=""
        placeholder="Borders"
        options={EDGES.map((one) => ({ label: one.label, value: one.label }))}
        onPick={(value) => {
          const chosen = EDGES.find((one) => one.label === value)
          if (chosen !== undefined) onFormat(chosen.look)
        }}
      />

      <Divider />

      <select
        aria-label="Number format"
        className="h-6 rounded border border-border bg-surface px-1 text-xs text-text outline-none focus:border-accent"
        value=""
        onChange={(event) => {
          const code = FORMATS.find((one) => one.label === event.target.value)?.code
          if (code === null) {
            // The custom dialog is the next thing to build; until it is, the
            // choice does nothing rather than doing something unasked.
            return
          }
          if (code !== undefined) onFormat({ numberFormat: code })
        }}
      >
        {/* Blank and unselectable: the dropdown is a way to set a format, not
            a claim about which of them the cell currently has. */}
        <option value="" disabled>
          Format
        </option>
        {FORMATS.map((one) => (
          <option key={one.label} value={one.label}>
            {one.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const Divider = () => <span className="mx-1 h-4 w-px bg-border" aria-hidden />

/**
 * A dropdown that shows what is chosen, or asks when nothing is.
 *
 * A `placeholder` makes it a way to set something rather than a claim about
 * what is set — which is what the borders need, since a cell's four edges do
 * not add up to one entry in a list.
 */
function Chooser({
  label,
  value,
  options,
  placeholder,
  onPick,
}: {
  label: string
  value: string
  options: { label: string; value: string }[]
  placeholder?: string
  onPick: (value: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      className="h-6 max-w-28 rounded border border-border bg-surface px-1 text-xs text-text outline-none focus:border-accent"
      onChange={(event) => {
        onPick(event.target.value)
      }}
    >
      <option value="" disabled>
        {placeholder ?? label}
      </option>
      {options.map((one) => (
        <option key={one.value} value={one.value}>
          {one.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  label,
  on,
  onClick,
  children,
}: {
  label: string
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded text-xs ${
        on ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * A colour, chosen with the platform's own picker.
 *
 * A palette of our own would be a palette of our own opinions; the host
 * already has one that people know, with an eyedropper and their recent
 * colours in it.
 */
function Swatch({
  label,
  value,
  onPick,
}: {
  label: string
  value: string
  onPick: (value: string) => void
}) {
  return (
    <label className="flex h-6 w-6 cursor-pointer items-center justify-center rounded hover:bg-surface">
      <span className="sr-only">{label}</span>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => {
          onPick(event.target.value)
        }}
        className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
      />
    </label>
  )
}
