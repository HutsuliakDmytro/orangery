import { useCurrentEditor } from '@tiptap/react'
import { HIGHLIGHT_COLORS, TEXT_COLOR_SWATCHES } from '../editor/colors'
import { uniformBorders, withBorders } from '../ooxml/table-borders'
import type { Border } from '../ooxml/table-borders'
import { closePicker, useOpenPicker } from '../editor/commands/picker-store'
import { AltTextDialog } from './alt-text-dialog'
import { ColorPicker } from './color-picker'
import { SpecialCharactersDialog } from './special-characters-dialog'
import { TableBordersDialog } from './table-borders-dialog'
import { TableGridPicker } from './table-grid-picker'
import { FontFamilyPicker, FontSizePicker } from './font-picker'
import { LinkDialog } from './link-dialog'
import { LineSpacingPicker } from './line-spacing-picker'

/** Highlight swatches laid out five to a row, like Word's marker grid. */
const HIGHLIGHT_SWATCHES = [
  HIGHLIGHT_COLORS.slice(0, 5),
  HIGHLIGHT_COLORS.slice(5, 10),
  HIGHLIGHT_COLORS.slice(10, 15),
]

/**
 * Renders whichever picker a command opened. Mounted once in the app shell;
 * the pickers themselves mount only while open, so they always read fresh
 * attributes from the current selection.
 */
export function FormatPickers() {
  const { editor } = useCurrentEditor()
  const openPicker = useOpenPicker()

  if (!editor || !openPicker) return null

  const textStyle = editor.getAttributes('textStyle')
  const color = typeof textStyle['color'] === 'string' ? textStyle['color'] : null
  const fontFamily = typeof textStyle['fontFamily'] === 'string' ? textStyle['fontFamily'] : null
  const fontSize = typeof textStyle['fontSize'] === 'number' ? textStyle['fontSize'] : null

  const block = editor.isActive('heading') ? 'heading' : 'paragraph'
  const blockAttributes = editor.getAttributes(block)
  const numeric = (key: string): number | null =>
    typeof blockAttributes[key] === 'number' ? blockAttributes[key] : null

  switch (openPicker) {
    case 'text-color':
      return (
        <ColorPicker
          title="Text color"
          swatches={TEXT_COLOR_SWATCHES}
          resetLabel={color ? 'Reset' : null}
          onPick={(hex) => {
            editor.chain().focus().setColor(hex).run()
          }}
          onReset={() => {
            editor.chain().focus().unsetColor().run()
          }}
          onClose={closePicker}
        />
      )

    case 'highlight':
      return (
        <ColorPicker
          title="Highlight color"
          swatches={HIGHLIGHT_SWATCHES}
          resetLabel={editor.isActive('highlight') ? 'None' : null}
          onPick={(hex) => {
            editor.chain().focus().setHighlight({ color: hex }).run()
          }}
          onReset={() => {
            editor.chain().focus().unsetHighlight().run()
          }}
          onClose={closePicker}
        />
      )

    case 'font-family':
      return (
        <FontFamilyPicker
          current={fontFamily}
          onPick={(family) => {
            editor.chain().focus().setFontFamily(family).run()
          }}
          onClose={closePicker}
        />
      )

    case 'line-spacing':
      return (
        <LineSpacingPicker
          lineHeight={numeric('lineHeight')}
          spaceBefore={numeric('spaceBefore')}
          spaceAfter={numeric('spaceAfter')}
          onPickLineHeight={(multiplier) => {
            editor.chain().focus().setLineHeight(multiplier).run()
          }}
          onPickSpacing={(spacing) => {
            editor.chain().focus().setParagraphSpacing(spacing).run()
          }}
          onClose={closePicker}
        />
      )

    case 'link': {
      const href: unknown = editor.getAttributes('link')['href']
      const { from, to } = editor.state.selection
      const selectedText = editor.state.doc.textBetween(from, to, ' ')

      return (
        <LinkDialog
          href={typeof href === 'string' ? href : null}
          selectedText={selectedText}
          onApply={(url, text) => {
            const chain = editor.chain().focus().extendMarkRange('link')
            if (selectedText === text && selectedText !== '') {
              chain.setLink({ href: url }).run()
              return
            }
            // Replacing the text as well: insert it, then mark the inserted range.
            chain
              .insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href: url } }],
              })
              .run()
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
          }}
          onClose={closePicker}
        />
      )
    }

    case 'image-alt': {
      const alt: unknown = editor.getAttributes('image')['alt']
      return (
        <AltTextDialog
          current={typeof alt === 'string' ? alt : ''}
          onApply={(value) => {
            editor.chain().focus().updateAttributes('image', { alt: value }).run()
          }}
          onClose={closePicker}
        />
      )
    }

    case 'table-grid':
      return (
        <TableGridPicker
          onPick={({ rows, cols }) => {
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run()
          }}
          onClose={closePicker}
        />
      )

    case 'table-borders': {
      const attrs = editor.getAttributes('table')
      const existing: unknown = attrs['borders']
      const top =
        typeof existing === 'object' && existing !== null
          ? ((existing as Record<string, Border | undefined>)['top'] ?? null)
          : null

      return (
        <TableBordersDialog
          current={top}
          onApply={(border) => {
            const borders = uniformBorders(border)
            editor
              .chain()
              .focus()
              .updateAttributes('table', {
                borders,
                // The preserved `w:tblPr` is patched rather than replaced, so
                // table style, width and layout survive a border change.
                tblPr: withBorders(
                  typeof attrs['tblPr'] === 'string' ? attrs['tblPr'] : null,
                  borders,
                ),
              })
              .run()
          }}
          onClose={closePicker}
        />
      )
    }

    case 'cell-background':
      return (
        <ColorPicker
          title="Cell background"
          swatches={TEXT_COLOR_SWATCHES}
          resetLabel="None"
          onPick={(hex) => {
            editor.chain().focus().setCellAttribute('background', hex).run()
          }}
          onReset={() => {
            editor.chain().focus().setCellAttribute('background', null).run()
          }}
          onClose={closePicker}
        />
      )

    case 'special-characters':
      return (
        <SpecialCharactersDialog
          onPick={(character) => {
            editor.chain().focus().insertContent(character).run()
          }}
          onClose={closePicker}
        />
      )

    case 'find-replace':
      // Rendered by the app shell as a docked panel, not as an overlay.
      return null

    case 'font-size':
      return (
        <FontSizePicker
          current={fontSize}
          onPick={(size) => {
            editor.chain().focus().setFontSize(size).run()
          }}
          onClose={closePicker}
        />
      )
  }
}
