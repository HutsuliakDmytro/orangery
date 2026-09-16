import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  AlignHorizontalDistributeCenter,
  ImagePlus,
  Indent,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Omega,
  Outdent,
  PaintBucket,
  Paintbrush,
  Palette,
  Plus,
  Redo2,
  Strikethrough,
  Grid3x3,
  Table as TableIcon,
  Underline,
  Undo2,
} from 'lucide-react'
import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_FONT_SIZE } from '../editor/extensions/font-size'
import { requestPicker } from '../editor/commands/picker-store'
import { runCommand } from '../editor/commands/registry'
import { useStylesStore } from '../store/styles-store'
import { useViewStore, ZOOM_LEVELS } from '../store/view-store'
import { ToolbarButton, ToolbarSeparator } from './toolbar-button'
import { useRovingFocus } from './use-roving-focus'

/**
 * Single-row toolbar in the Google Docs arrangement, not a Word ribbon
 * (CLAUDE.md "Design system"). Every control dispatches through the command
 * registry; the dropdowns read the current value from the editor state.
 */
export function Toolbar() {
  const { t } = useTranslation()
  const { editor } = useCurrentEditor()
  const zoom = useViewStore((state) => state.zoom)
  const setZoom = useViewStore((state) => state.setZoom)
  // The list comes from the open document: offering a style the file does not
  // define would render as plain body text in Word.
  const styleOptions = useStylesStore((state) => state.options)
  // One Tab stop for the whole toolbar; arrow keys move between controls.
  const { containerRef, onKeyDown } = useRovingFocus()

  const current = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null
      const textStyle = instance.getAttributes('textStyle')

      return {
        styleId: instance.isActive('heading')
          ? `Heading${String(instance.getAttributes('heading')['level'] ?? 1)}`
          : typeof instance.getAttributes('paragraph')['styleId'] === 'string'
            ? String(instance.getAttributes('paragraph')['styleId'])
            : 'Normal',
        fontFamily: typeof textStyle['fontFamily'] === 'string' ? textStyle['fontFamily'] : '',
        fontSize:
          typeof textStyle['fontSize'] === 'number' ? textStyle['fontSize'] : DEFAULT_FONT_SIZE,
      }
    },
    equalityFn: (a, b) =>
      a?.styleId === b?.styleId && a?.fontFamily === b?.fontFamily && a?.fontSize === b?.fontSize,
  })

  const dispatch = (id: string) => {
    if (editor) runCommand(id, { editor })
  }

  /**
   * Applies a style by its OOXML id. Headings become heading nodes; everything
   * else becomes a paragraph carrying the style id, which is how Word models it.
   */
  const applyStyle = (styleId: string) => {
    if (!editor) return

    const option = styleOptions.find((entry) => entry.id === styleId)

    if (option?.headingLevel !== null && option?.headingLevel !== undefined) {
      dispatch(`paragraph.heading-${String(option.headingLevel)}`)
      return
    }

    if (styleId === 'Normal') {
      dispatch('paragraph.normal')
      return
    }

    editor.chain().focus().setParagraph().updateAttributes('paragraph', { styleId }).run()
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      role="toolbar"
      aria-label={t('toolbar.formatting')}
      aria-orientation="horizontal"
      className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-surface px-2 py-1"
    >
      <ToolbarButton id="edit.undo" icon={Undo2} />
      <ToolbarButton id="edit.redo" icon={Redo2} />

      <ToolbarSeparator />

      <label className="sr-only" htmlFor="toolbar-zoom">
        {t('toolbar.zoom')}
      </label>
      <select
        id="toolbar-zoom"
        value={String(zoom)}
        onChange={(event) => {
          setZoom(Number.parseFloat(event.target.value))
        }}
        className="h-7 rounded bg-transparent px-1 text-xs text-text outline-none"
      >
        {ZOOM_LEVELS.map((level) => (
          <option key={level} value={String(level)}>
            {`${String(Math.round(level * 100))}%`}
          </option>
        ))}
      </select>

      <ToolbarSeparator />

      <label className="sr-only" htmlFor="toolbar-style">
        {t('toolbar.paragraphStyle')}
      </label>
      <select
        id="toolbar-style"
        value={current?.styleId ?? 'Normal'}
        onChange={(event) => {
          applyStyle(event.target.value)
        }}
        className="h-7 w-32 rounded bg-transparent px-1 text-xs text-text outline-none"
      >
        {styleOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      <ToolbarSeparator />

      <button
        type="button"
        onClick={() => {
          requestPicker('font-family')
        }}
        className="h-7 w-28 truncate rounded px-2 text-left text-xs text-text hover:bg-surface-2"
        title={t('toolbar.font')}
      >
        {current?.fontFamily === '' || current?.fontFamily === undefined
          ? t('toolbar.defaultFont')
          : current.fontFamily}
      </button>

      <ToolbarButton id="format.decrease-font-size" icon={Minus} />
      <button
        type="button"
        onClick={() => {
          requestPicker('font-size')
        }}
        className="h-7 w-10 rounded text-center text-xs text-text hover:bg-surface-2"
        title={t('toolbar.fontSize')}
      >
        {String(current?.fontSize ?? DEFAULT_FONT_SIZE)}
      </button>
      <ToolbarButton id="format.increase-font-size" icon={Plus} />

      <ToolbarSeparator />

      <ToolbarButton id="format.bold" icon={Bold} />
      <ToolbarButton id="format.italic" icon={Italic} />
      <ToolbarButton id="format.underline" icon={Underline} />
      <ToolbarButton id="format.strike" icon={Strikethrough} />
      <ToolbarButton id="format.text-color" icon={Palette} />
      <ToolbarButton id="format.highlight" icon={Highlighter} />
      <ToolbarButton id="format.copy-formatting" icon={Paintbrush} />
      <ToolbarButton id="format.paste-formatting" icon={PaintBucket} />

      <ToolbarSeparator />

      <ToolbarButton id="insert.link" icon={Link2} />
      <ToolbarButton id="insert.table" icon={TableIcon} />
      <ToolbarButton id="table.borders" icon={Grid3x3} />
      <ToolbarButton id="insert.image" icon={ImagePlus} />
      <ToolbarButton id="insert.image-wrap-left" icon={AlignHorizontalDistributeCenter} />
      <ToolbarButton id="insert.table-of-contents" icon={ListTree} />
      <ToolbarButton id="insert.special-character" icon={Omega} />

      <ToolbarSeparator />

      <ToolbarButton id="paragraph.align-left" icon={AlignLeft} />
      <ToolbarButton id="paragraph.align-center" icon={AlignCenter} />
      <ToolbarButton id="paragraph.align-right" icon={AlignRight} />
      <ToolbarButton id="paragraph.align-justify" icon={AlignJustify} />

      <ToolbarSeparator />

      <ToolbarButton id="paragraph.bullet-list" icon={List} />
      <ToolbarButton id="paragraph.ordered-list" icon={ListOrdered} />
      <ToolbarButton id="paragraph.task-list" icon={ListChecks} />
      <ToolbarButton id="paragraph.outdent" icon={Outdent} />
      <ToolbarButton id="paragraph.indent" icon={Indent} />
    </div>
  )
}
