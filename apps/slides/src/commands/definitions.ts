import { register, registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import {
  nameOf,
  pickPicturePath,
  pickDirectory,
  pickExportPath,
  readFileBytes,
  writeFileBytes,
} from '../document/file'
import {
  addSection,
  addSlide,
  alignmentBounds,
  alignShapes,
  createShape,
  deleteShapes,
  duplicateSlides,
  insertConnector,
  insertIcon,
  flatten,
  geometryPoints,
  insertColumn,
  insertRow,
  mergeCells,
  removeColumn,
  removeRow,
  splitCell,
  saveDeck,
  moveSlide,
  readSections,
  removeSection,
  removeSlides,
  distributeShapes,
  duplicateShape,
  flipShapes,
  groupShapes,
  moveShape,
  reorderShapes,
  sectionOfSlide,
  ungroupShape,
  withAncestors,
  convertDiagramToShapes,
  diagramDrawingPart,
  writeBackgroundPicture,
  writePart,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import type { Alignment, Shape, Slide } from '@orangery/ooxml-presentation'
import { findDescendant } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { pictureName, rasterise, slideSvg } from '../document/export-image'
import type { RasterType } from '../document/export-image'
import { ICON_SIZE, ICONS } from '../document/icons'
import {
  closeDeck,
  exportOdp,
  exportTheme,
  exportVideoFile,
  newDeck,
  openDeck,
  openInNewWindow,
  saveDeckFile,
} from '../document/file-operations'
import { stepsPerSlide } from '../render/animation'
import { groupAfterEscape } from '../render/selection'
import { insertPictureOnSlide } from '../document/insert-picture'
import { copySelection, pasteShapesHere } from '../document/shape-clipboard'
import { startReview } from '../document/review'
import { copyFormatting, heldFormat, pasteFormatting } from '../document/format-painter'
import { whenSafe } from '../document/unsaved'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { closeShowWindows, openShowWindows } from '../document/show-windows'
import { useShowStore } from '../store/show-store'
import { useEditorStore } from '../store/editor-store'
import { useViewStore } from '../store/view-store'

/**
 * What Slides can do so far.
 *
 * The registry is the single source of actions: whatever is here appears in the
 * native menu and the command palette without either being told separately
 * (`apps/docs/docs/adr/0002-command-registry.md`).
 *
 * A command the build cannot run is registered disabled rather than left out.
 * The menu is the shape of the application: a File menu with nothing in it says
 * the app cannot open a deck at all, while a greyed-out Open says only that
 * there is no file dialog outside the shell.
 */

export const fileCommands: readonly Command[] = [
  {
    id: 'file.open',
    label: 'Open…',
    group: 'file',
    shortcut: 'Mod+o',
    // Nothing to pick a file with outside the app shell, so the browser build
    // shows the command greyed out rather than failing when it is used.
    isEnabled: () => isTauri(),
    run: () => {
      whenSafe(openDeck)
    },
  },
  {
    id: 'file.close',
    label: 'Close Presentation',
    group: 'file',
    shortcut: 'Mod+w',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      whenSafe(closeDeck)
    },
  },
  {
    id: 'file.save',
    label: 'Save',
    group: 'file',
    shortcut: 'Mod+s',
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void saveDeckFile(false)
    },
  },
  {
    id: 'file.save-as',
    label: 'Save As…',
    group: 'file',
    shortcut: 'Mod+Shift+s',
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void saveDeckFile(true)
    },
  },
  {
    id: 'file.new',
    label: 'New Presentation',
    group: 'file',
    shortcut: 'Mod+n',
    // No shell needed: a new deck is built in memory and is a real package from
    // the first keystroke, so the browser build can make one it cannot save.
    isEnabled: () => true,
    run: () => {
      whenSafe(newDeck)
    },
  },
  {
    id: 'file.new-from-template',
    label: 'New from Template…',
    group: 'file',
    isEnabled: () => true,
    run: () => {
      // The question about unsaved work waits until a template is chosen: it
      // would be a poor trade to ask it and then have the person change their
      // mind about starting a deck at all.
      useViewStore.getState().setChoosingTemplate(true)
    },
  },
  {
    id: 'file.new-window',
    label: 'New Window',
    group: 'file',
    shortcut: 'Mod+Shift+n',
    // A window is the shell's to make, so there is nothing to offer in a
    // browser — and nothing is displaced either, so no question is asked.
    isEnabled: () => isTauri(),
    run: () => {
      void openInNewWindow()
    },
  },
]

export const slideCommands: readonly Command[] = [
  {
    id: 'view.next-slide',
    label: 'Next Slide',
    group: 'view',
    shortcut: 'PageDown',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { current, select } = useDeckStore.getState()
      select(current + 1)
    },
  },
  {
    id: 'view.previous-slide',
    label: 'Previous Slide',
    group: 'view',
    shortcut: 'PageUp',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { current, select } = useDeckStore.getState()
      select(current - 1)
    },
  },
]

/** One nudge of an arrow key: a point, which is what PowerPoint moves by. */
const NUDGE = 12700

function nudge(dx: number, dy: number): void {
  const { selection, edit } = useDeckStore.getState()
  if (selection.length === 0) return

  edit((slide) =>
    slide.shapes
      .filter((shape) => selection.includes(shape.id))
      .map((shape) => moveShape(shape, { x: dx, y: dy }))
      // Reduced rather than `some`, so every selected shape moves before the
      // answer is worked out.
      .reduce((moved: boolean, one) => moved || one, false),
  )
}

/** Whether the pointer is working inside a group on the current slide. */
function insideGroup(): boolean {
  return useDeckStore.getState().openGroup !== null
}

/**
 * Steps out of the open group by one.
 *
 * Which chain to step out along comes from what is selected, because that is
 * what is inside the group. Leaving selects the group just left, which is where
 * a person expects to find themselves: back holding the thing they went into.
 */
function leaveGroup(): void {
  const { openGroup, selection, setOpenGroup, selectShapes } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (openGroup === null || slide === null) return

  const held = withAncestors(slide.shapes).find(({ shape }) => selection.includes(shape.id))
  const next = groupAfterEscape(openGroup, held?.ancestors ?? [])

  setOpenGroup(next)
  selectShapes([openGroup])
}

export const editCommands: readonly Command[] = [
  {
    id: 'edit.undo',
    label: 'Undo',
    group: 'edit',
    shortcut: 'Mod+z',
    isEnabled: () => useDeckStore.getState().undoStack.length > 0,
    run: () => {
      useDeckStore.getState().undo()
    },
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    group: 'edit',
    shortcut: 'Mod+Shift+z',
    isEnabled: () => useDeckStore.getState().redoStack.length > 0,
    run: () => {
      useDeckStore.getState().redo()
    },
  },
  {
    id: 'edit.find',
    label: 'Find and Replace…',
    group: 'edit',
    shortcut: 'Mod+f',
    isEnabled: () => useDeckStore.getState().open !== null,
    isActive: () => useViewStore.getState().finding,
    run: () => {
      const { finding, setFinding } = useViewStore.getState()
      setFinding(!finding)
    },
  },
  {
    id: 'format.edit-points',
    label: 'Edit Points',
    group: 'format',
    // Only a shape that states its own outline has points to move. A preset's
    // shape is a name rather than a list of corners, and offering handles that
    // did nothing would be worse than offering none.
    isEnabled: () => {
      const slide = currentSlide(useDeckStore.getState())
      const selection = useDeckStore.getState().selection
      if (slide === null || selection.length !== 1) return false

      const shape = flatten(slide.shapes).find((one) => selection.includes(one.id))
      return shape !== undefined && geometryPoints(shape).length > 0
    },
    run: () => {
      const { editingPoints, selection, setEditingPoints } = useDeckStore.getState()
      const first = selection[0] ?? null
      // A toggle, because the way out of it is the same gesture as the way in
      // as well as `Escape`.
      setEditingPoints(editingPoints === first ? null : first)
    },
  },
  {
    id: 'edit.leave-points',
    label: 'Finish Editing Points',
    group: 'edit',
    shortcut: 'Escape',
    isEnabled: () => useDeckStore.getState().editingPoints !== null,
    run: () => {
      useDeckStore.getState().setEditingPoints(null)
    },
  },
  {
    id: 'edit.leave-crop',
    label: 'Finish Cropping',
    group: 'edit',
    shortcut: 'Escape',
    isEnabled: () => useDeckStore.getState().cropping !== null,
    run: () => {
      useDeckStore.getState().setCropping(null)
    },
  },
  {
    id: 'edit.leave-group',
    label: 'Leave Group',
    group: 'edit',
    shortcut: 'Escape',
    // A second Escape, after the one that leaves a text box: they are separate
    // commands because they are separate places to be, and one keystroke that
    // did both would take two steps out of a group whose member was being typed
    // in.
    isEnabled: () => useDeckStore.getState().editing === null && onSlides() && insideGroup(),
    run: () => {
      leaveGroup()
    },
  },
  {
    id: 'edit.leave-text',
    label: 'Finish Editing Text',
    group: 'edit',
    shortcut: 'Escape',
    // At the window rather than inside the editor: Escape should leave the
    // shape wherever the focus happens to be.
    isEnabled: () => {
      const view = useViewStore.getState()
      return (
        useDeckStore.getState().editing !== null ||
        view.editingNotes ||
        view.editingOutline !== null
      )
    },
    run: () => {
      useDeckStore.getState().setEditing(null)

      const view = useViewStore.getState()
      view.setEditingNotes(false)
      view.setEditingOutline(null)
    },
  },
  {
    id: 'edit.delete',
    label: 'Delete',
    group: 'edit',
    shortcut: 'Backspace',
    isEnabled: () => useDeckStore.getState().selection.length > 0,
    run: () => {
      const { edit, selectShapes } = useDeckStore.getState()
      edit((slide) => deleteShapes(slide, selected(slide)))
      selectShapes([])
    },
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    group: 'edit',
    shortcut: 'Mod+c',
    isEnabled: () => useDeckStore.getState().selection.length > 0,
    run: () => {
      void copySelection()
    },
  },
  {
    id: 'edit.cut',
    label: 'Cut',
    group: 'edit',
    shortcut: 'Mod+x',
    isEnabled: () => useDeckStore.getState().selection.length > 0,
    run: () => {
      void (async () => {
        // Deleted only once the copy has landed: a cut that failed to copy and
        // deleted anyway is the one way this command can lose work.
        if (!(await copySelection())) return
        useDeckStore.getState().edit((slide) => deleteShapes(slide, selected(slide)))
        useDeckStore.getState().selectShapes([])
      })()
    },
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    group: 'edit',
    shortcut: 'Mod+v',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      void pasteShapesHere()
    },
  },
  {
    id: 'edit.paste-keep-source',
    label: 'Paste Keeping Source Formatting',
    group: 'edit',
    keywords: ['paste', 'special', 'formatting'],
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      void pasteShapesHere({ formatting: 'source' })
    },
  },
  {
    id: 'edit.paste-text-only',
    label: 'Paste Text Only',
    group: 'edit',
    keywords: ['paste', 'special', 'text', 'unformatted'],
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      void pasteShapesHere({ textOnly: true })
    },
  },
  {
    id: 'edit.paste-special',
    label: 'Paste Special…',
    group: 'edit',
    shortcut: 'Mod+Shift+v',
    keywords: ['clipboard', 'history', 'formatting'],
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useViewStore.getState().setPasting(true)
    },
  },
  {
    id: 'edit.duplicate',
    label: 'Duplicate',
    group: 'edit',
    shortcut: 'Mod+d',
    isEnabled: () => useDeckStore.getState().selection.length > 0,
    run: () => {
      const { selection, edit, selectShapes } = useDeckStore.getState()
      const copies: number[] = []

      edit((slide) => {
        for (const shape of slide.shapes.filter((one) => selection.includes(one.id))) {
          const id = duplicateShape(slide, shape)
          if (id !== null) copies.push(id)
        }
        return copies.length > 0
      })

      // The copies become the selection, as they do everywhere else: the next
      // thing anyone does is move them.
      if (copies.length > 0) selectShapes(copies)
    },
  },
  {
    id: 'edit.select-all',
    label: 'Select All',
    group: 'edit',
    shortcut: 'Mod+a',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { open, current, selectShapes } = useDeckStore.getState()
      const slide = open?.deck.slides[current]
      selectShapes((slide?.shapes ?? []).map((shape) => shape.id))
    },
  },
  ...(
    [
      ['left', 'Left', -NUDGE, 0],
      ['right', 'Right', NUDGE, 0],
      ['up', 'Up', 0, -NUDGE],
      ['down', 'Down', 0, NUDGE],
    ] as const
  ).map(([id, label, dx, dy]) => ({
    id: `edit.nudge-${id}`,
    label: `Nudge ${label}`,
    group: 'edit' as const,
    shortcut: `Arrow${label}`,
    isEnabled: () => useDeckStore.getState().selection.length > 0,
    run: () => {
      nudge(dx, dy)
    },
  })),
]

/** The shapes the selection names, on the slide being shown. */
function selected(slide: Slide): Shape[] {
  const { selection } = useDeckStore.getState()
  return slide.shapes.filter((shape) => selection.includes(shape.id))
}

/**
 * The table the picked cells are in, and the `a:tbl` under it.
 *
 * Both, because every command here changes the XML and then has to write the
 * part the XML came from; one without the other is a change nothing saves.
 */
function pickedTable(): {
  table: XmlNode
  cells: NonNullable<ReturnType<typeof cellsPicked>>
} | null {
  const cells = cellsPicked()
  const slide = currentSlide(useDeckStore.getState())
  if (cells === null || slide === null) return null

  const frame = flatten(slide.shapes).find((shape) => shape.id === cells.table)
  const table = frame === undefined ? undefined : findDescendant(frame.node, 'a:tbl')
  return table === undefined ? null : { table, cells }
}

const cellsPicked = () => useDeckStore.getState().cells

/** Runs a change against the picked table, as one undo step. */
function editTable(change: (table: XmlNode) => boolean): void {
  useDeckStore.getState().edit(() => {
    const found = pickedTable()
    return found === null ? false : change(found.table)
  })
}

export const tableEditCommands: readonly Command[] = [
  {
    id: 'table.row-above',
    label: 'Insert Row Above',
    group: 'insert',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => insertRow(table, cellsPicked()?.row ?? 0, false))
    },
  },
  {
    id: 'table.row-below',
    label: 'Insert Row Below',
    group: 'insert',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => insertRow(table, cellsPicked()?.toRow ?? 0, true))
    },
  },
  {
    id: 'table.column-left',
    label: 'Insert Column Left',
    group: 'insert',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => insertColumn(table, cellsPicked()?.column ?? 0, false))
    },
  },
  {
    id: 'table.column-right',
    label: 'Insert Column Right',
    group: 'insert',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => insertColumn(table, cellsPicked()?.toColumn ?? 0, true))
    },
  },
  {
    id: 'table.delete-row',
    label: 'Delete Row',
    group: 'edit',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => removeRow(table, cellsPicked()?.row ?? 0))
    },
  },
  {
    id: 'table.delete-column',
    label: 'Delete Column',
    group: 'edit',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => removeColumn(table, cellsPicked()?.column ?? 0))
    },
  },
  {
    id: 'table.merge',
    label: 'Merge Cells',
    group: 'format',
    // One cell is not a merge, and greying it out says which gesture is missing
    // rather than doing nothing when it is used.
    isEnabled: () => {
      const cells = cellsPicked()
      return cells !== null && (cells.row !== cells.toRow || cells.column !== cells.toColumn)
    },
    run: () => {
      editTable((table) => {
        const cells = cellsPicked()
        return cells === null ? false : mergeCells(table, cells)
      })
    },
  },
  {
    id: 'table.split',
    label: 'Split Cell',
    group: 'format',
    isEnabled: () => cellsPicked() !== null,
    run: () => {
      editTable((table) => {
        const cells = cellsPicked()
        return cells === null ? false : splitCell(table, cells.row, cells.column)
      })
    },
  },
]

export const alignCommands: readonly Command[] = (
  [
    ['left', 'Align Left'],
    ['centre', 'Align Centre'],
    ['right', 'Align Right'],
    ['top', 'Align Top'],
    ['middle', 'Align Middle'],
    ['bottom', 'Align Bottom'],
  ] as const
).map(([alignment, label]: readonly [Alignment, string]) => ({
  id: `format.align-${alignment}`,
  label,
  group: 'format' as const,
  isEnabled: () => useDeckStore.getState().selection.length > 0,
  run: () => {
    const { open, edit } = useDeckStore.getState()
    const size = open?.deck.slideSize ?? { width: 0, height: 0 }

    edit((slide) => {
      const shapes = selected(slide)
      return alignShapes(shapes, alignment, alignmentBounds(shapes, size))
    })
  },
}))

export const flipCommands: readonly Command[] = (
  [
    ['horizontal', 'Flip Horizontal'],
    ['vertical', 'Flip Vertical'],
  ] as const
).map(([axis, label]) => ({
  id: `format.flip-${axis}`,
  label,
  group: 'format' as const,
  isEnabled: () => useDeckStore.getState().selection.length > 0,
  run: () => {
    useDeckStore.getState().edit((slide) => flipShapes(selected(slide), axis))
  },
}))

export const distributeCommands: readonly Command[] = (
  [
    ['horizontal', 'Distribute Horizontally'],
    ['vertical', 'Distribute Vertically'],
  ] as const
).map(([axis, label]) => ({
  id: `format.distribute-${axis}`,
  label,
  group: 'format' as const,
  // Two shapes have no gap to divide; the command says so by being greyed out.
  isEnabled: () => useDeckStore.getState().selection.length > 2,
  run: () => {
    useDeckStore.getState().edit((slide) => distributeShapes(selected(slide), axis))
  },
}))

/** What the insert menu offers, and where a new shape lands. */
const PRESETS = [
  ['rect', 'Rectangle'],
  ['roundRect', 'Rounded Rectangle'],
  ['ellipse', 'Ellipse'],
  ['triangle', 'Triangle'],
  ['rightArrow', 'Arrow'],
  ['star5', 'Star'],
  ['line', 'Line'],
] as const

export const pictureCommands: readonly Command[] = [
  {
    id: 'slide.background-picture',
    label: 'Background Picture…',
    group: 'format',
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void backgroundPictureFromDisk()
    },
  },
  {
    id: 'insert.picture',
    label: 'Picture…',
    group: 'insert',
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void insertPictureFromDisk()
    },
  },
]

/**
 * Formatting the text being edited.
 *
 * These act on the editor rather than on the shape: a run is a stretch of the
 * selection, not a property of the box around it. With nothing being edited
 * they grey out — bolding a whole shape is a different feature, and pretending
 * these do it would set the formatting of text nobody selected.
 */
export const textCommands: readonly Command[] = [
  ...(
    [
      ['bold', 'Bold', 'Mod+b'],
      ['italic', 'Italic', 'Mod+i'],
      ['underline', 'Underline', 'Mod+u'],
      ['strike', 'Strikethrough', 'Mod+Shift+x'],
      ['superscript', 'Superscript', 'Mod+Shift+.'],
      ['subscript', 'Subscript', 'Mod+Shift+,'],
    ] as const
  ).map(([mark, label, shortcut]) => ({
    id: `format.${mark}`,
    label,
    group: 'format' as const,
    shortcut,
    isActive: () => {
      const { editor } = useEditorStore.getState()
      return editor?.isActive(mark) ?? false
    },
    isEnabled: () => useEditorStore.getState().editor !== null,
    run: () => {
      const { editor } = useEditorStore.getState()
      if (mark === 'bold') editor?.chain().focus().toggleBold().run()
      if (mark === 'italic') editor?.chain().focus().toggleItalic().run()
      if (mark === 'underline') editor?.chain().focus().toggleUnderline().run()
      if (mark === 'strike') editor?.chain().focus().toggleStrike().run()
      // A raise and a drop are the same attribute with opposite signs, so one
      // replaces the other rather than stacking with it.
      if (mark === 'superscript') editor?.chain().focus().unsetSubscript().toggleSuperscript().run()
      if (mark === 'subscript') editor?.chain().focus().unsetSuperscript().toggleSubscript().run()
    },
  })),
  ...(
    [
      ['demote', 'Demote', 'Tab', 1],
      ['promote', 'Promote', 'Shift+Tab', -1],
    ] as const
  ).map(([id, label, shortcut, by]) => ({
    id: `format.${id}`,
    label,
    group: 'format' as const,
    shortcut,
    isEnabled: () => useEditorStore.getState().editor !== null,
    run: () => {
      const { editor } = useEditorStore.getState()
      if (editor === null) return

      // Nine levels, counted from zero, which is what the file says and what
      // every list style is keyed by.
      const current = Number(editor.getAttributes('paragraph')['level'] ?? 0)
      const level = Math.min(Math.max(current + by, 0), 8)
      editor.chain().focus().updateAttributes('paragraph', { level }).run()
    },
  })),
]

/** Setting an attribute on the paragraph the cursor is in. */
function setParagraph(attributes: Record<string, unknown>): void {
  useEditorStore.getState().editor?.chain().focus().updateAttributes('paragraph', attributes).run()
}

function paragraphAttribute(name: string): unknown {
  return useEditorStore.getState().editor?.getAttributes('paragraph')[name]
}

/** A quarter inch, which is the step Word and PowerPoint both indent by. */
const INDENT_STEP = 228600

/**
 * Moving a paragraph in or out.
 *
 * Distinct from `Tab`, which changes the outline level: a level is a rung on
 * the master's list style and brings a bullet and a size with it, while an
 * indent is a distance and brings nothing. Offering only the first, as this did,
 * means a paragraph can be moved but not moved *a little*.
 */
export const indentCommands: readonly Command[] = (
  [
    ['in', 'Increase Indent', 1],
    ['out', 'Decrease Indent', -1],
  ] as const
).map(([id, label, direction]) => ({
  id: `format.indent-${id}`,
  label,
  group: 'format' as const,
  isEnabled: () => useEditorStore.getState().editor !== null,
  run: () => {
    const current = paragraphAttribute('marginLeft')
    const from = typeof current === 'number' ? current : 0
    const next = Math.max(from + direction * INDENT_STEP, 0)

    // Back to nothing is back to inheriting, not a stated zero: a paragraph
    // indented and then un-indented should be the paragraph it was.
    setParagraph({ marginLeft: next === 0 ? null : next })
  },
}))

export const paragraphCommands: readonly Command[] = [
  ...(
    [
      ['left', 'Align Text Left', 'l'],
      ['centre', 'Centre Text', 'ctr'],
      ['right', 'Align Text Right', 'r'],
      ['justify', 'Justify Text', 'just'],
    ] as const
  ).map(([id, label, value]) => ({
    id: `format.text-${id}`,
    label,
    group: 'format' as const,
    isActive: () => paragraphAttribute('align') === value,
    isEnabled: () => useEditorStore.getState().editor !== null,
    run: () => {
      // Clicking the alignment a paragraph already has clears it, which puts
      // the inherited one back rather than freezing today's answer into the file.
      setParagraph({ align: paragraphAttribute('align') === value ? null : value })
    },
  })),
  ...(
    [
      ['bullet', 'Bulleted List', 'character'],
      ['number', 'Numbered List', 'number'],
      ['no-bullet', 'No Bullet', 'none'],
    ] as const
  ).map(([id, label, kind]) => ({
    id: `format.${id}`,
    label,
    group: 'format' as const,
    isActive: () => paragraphAttribute('bullet') === kind,
    isEnabled: () => useEditorStore.getState().editor !== null,
    run: () => {
      // Turning off the one already set means "inherit", not "none": the level
      // has an answer and the paragraph goes back to it.
      setParagraph({ bullet: paragraphAttribute('bullet') === kind ? 'inherit' : kind })
    },
  })),
]

/**
 * Slides themselves: adding, copying, removing, reordering.
 *
 * A slide is a part of the package rather than a node in a document, so these
 * go through `editPackage`, which compares the whole package — the only way to
 * notice a part appearing.
 */
/**
 * Whether the canvas is showing a slide rather than a layout or a master.
 *
 * The commands about slides — adding one, deleting one, sections — say nothing
 * about a layout, and offering them there would ask which slide was meant when
 * none is on screen.
 */
function onSlides(): boolean {
  const { open, master } = useDeckStore.getState()
  return open !== null && master === null
}

/** The section the slide being shown falls in, or null when there are none. */
function sectionHere() {
  const { open, current } = useDeckStore.getState()
  if (open === null || current < 0) return null

  const sections = readSections(open.package)
  return sections[sectionOfSlide(sections, current)] ?? null
}

export const slideEditCommands: readonly Command[] = [
  {
    id: 'slide.new',
    label: 'New Slide',
    group: 'insert',
    shortcut: 'Mod+m',
    isEnabled: () => onSlides(),
    run: () => {
      const { open, current, editPackage, select } = useDeckStore.getState()
      if (open === null) return

      // Built on the layout of the slide being shown, which is what PowerPoint
      // does: a new slide after a section header looks like its neighbours.
      const here = open.deck.slides[current]
      const layout =
        (here?.layout == null ? undefined : open.deck.layouts.get(here.layout)) ??
        [...open.deck.layouts.values()][1] ??
        [...open.deck.layouts.values()][0]
      if (layout === undefined) return

      const added: { index: number | null } = { index: null }
      editPackage((deck) => {
        const result = addSlide(deck.package, deck.deck, layout, current)
        added.index = result?.index ?? null
        return result !== null
      })

      if (added.index !== null) select(added.index)
    },
  },
  {
    id: 'slide.duplicate',
    label: 'Duplicate Slide',
    group: 'edit',
    shortcut: 'Mod+Shift+d',
    isEnabled: () => onSlides(),
    run: () => {
      const { slideSelection, editPackage, selectSlides } = useDeckStore.getState()

      const copies: { indexes: number[] } = { indexes: [] }
      editPackage((open) => {
        const result = duplicateSlides(open.package, slideSelection)
        if (result === null) return false

        copies.indexes = result.paths.map((_, offset) => result.index + offset)
        return true
      })

      // The copies are what a person goes on to work with, so they end up
      // picked out rather than the originals they were made from.
      if (copies.indexes.length > 0) selectSlides(copies.indexes)
    },
  },
  {
    id: 'slide.delete',
    label: 'Delete Slide',
    group: 'edit',
    isEnabled: () => {
      const { open, slideSelection } = useDeckStore.getState()
      const count = open?.deck.slides.length ?? 0
      // A deck with no slides is one PowerPoint will not open, so deleting all
      // of them is not offered rather than silently doing part of it.
      return onSlides() && count > 0 && slideSelection.length < count
    },
    run: () => {
      const { slideSelection, editPackage, select } = useDeckStore.getState()
      const first = Math.min(...slideSelection)

      editPackage((open) => removeSlides(open.package, slideSelection))
      select(Math.max(first - 1, 0))
    },
  },
  {
    id: 'slide.layout',
    label: 'Change Layout…',
    group: 'edit',
    isEnabled: () => onSlides(),
    // Which of a master's dozen layouts was meant is not something a command can
    // guess, so this shows the picker rather than changing anything itself.
    run: () => {
      useDeckStore.getState().selectShapes([])
      const view = useViewStore.getState()
      if (!view.panels.properties) view.togglePanel('properties')
    },
  },
  {
    id: 'section.add',
    label: 'Add Section',
    group: 'insert',
    isEnabled: () => onSlides(),
    run: () => {
      const { open, current, editPackage } = useDeckStore.getState()
      if (open === null) return

      editPackage((deck) => addSection(deck.package, 'Untitled Section', current))

      // Straight into typing the name: a section called "Untitled Section" is
      // one nobody meant, and naming it is the whole point of making it. It is
      // found by where it begins rather than by being new — splitting a deck
      // that had none makes two sections, and the one that was asked for is the
      // one starting here.
      const added = readSections(useDeckStore.getState().open?.package ?? open.package).find(
        (section) => section.start === current,
      )
      if (added !== undefined) useViewStore.getState().setRenamingSection(added.id)
    },
  },
  {
    id: 'section.rename',
    label: 'Rename Section',
    group: 'edit',
    isEnabled: () => onSlides() && sectionHere() !== null,
    run: () => {
      const section = sectionHere()
      if (section !== null) useViewStore.getState().setRenamingSection(section.id)
    },
  },
  {
    id: 'section.remove',
    label: 'Remove Section',
    group: 'edit',
    isEnabled: () => onSlides() && sectionHere() !== null,
    run: () => {
      const section = sectionHere()
      if (section === null) return

      // The slides stay; only the boundary goes.
      useDeckStore.getState().editPackage((deck) => removeSection(deck.package, section.id))
    },
  },
  {
    id: 'slide.move-up',
    label: 'Move Slide Up',
    group: 'edit',
    isEnabled: () => onSlides() && useDeckStore.getState().current > 0,
    run: () => {
      const { current, editPackage, select } = useDeckStore.getState()
      editPackage((open) => moveSlide(open.package, current, current - 1))
      select(current - 1)
    },
  },
  {
    id: 'slide.move-down',
    label: 'Move Slide Down',
    group: 'edit',
    isEnabled: () => {
      const { open, current } = useDeckStore.getState()
      return onSlides() && current >= 0 && current < (open?.deck.slides.length ?? 0) - 1
    },
    run: () => {
      const { current, editPackage, select } = useDeckStore.getState()
      editPackage((open) => moveSlide(open.package, current, current + 1))
      select(current + 1)
    },
  },
]

/**
 * Showing the deck.
 *
 * Starting a show does not move the editor: leaving it puts a person back where
 * they were rather than where the show ended, which is what they meant by
 * "present from here" in the first place.
 */
export const showCommands: readonly Command[] = [
  {
    id: 'show.start',
    label: 'Start Slide Show',
    group: 'view',
    shortcut: 'F5',
    isEnabled: () => (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
    run: () => {
      void present(0)
    },
  },
  {
    id: 'show.start-here',
    label: 'Start Slide Show From This Slide',
    group: 'view',
    shortcut: 'Shift+F5',
    isEnabled: () => (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
    run: () => {
      void present(Math.max(useDeckStore.getState().current, 0))
    },
  },
  {
    id: 'show.rehearse',
    label: 'Rehearse Timings',
    group: 'view',
    keywords: ['practise', 'timing', 'timer'],
    isEnabled: () => (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
    run: () => {
      void present(0, true)
    },
  },
  {
    id: 'show.record',
    label: 'Record Slide Show',
    group: 'view',
    keywords: ['narration', 'voice', 'microphone', 'timing'],
    isEnabled: () => (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
    run: () => {
      void present(0, true, true)
    },
  },
  {
    id: 'show.end',
    label: 'End Slide Show',
    group: 'view',
    isEnabled: () => useShowStore.getState().at !== null,
    run: () => {
      useShowStore.getState().end()
      void closeShowWindows()
    },
  },
]

/**
 * Putting the deck on paper, which is also how it becomes a PDF.
 *
 * One mechanism rather than two: the operating system's print dialog saves to
 * PDF, and a PDF writer of our own would be a second way of drawing a slide and
 * so a second way of drawing it wrongly.
 */
export const printCommands: readonly Command[] = (
  [
    ['slides', 'Print Slides', 'Mod+p'],
    ['notes', 'Print Slides with Notes', undefined],
    ['handout-2', 'Print Handout, 2 per Page', undefined],
    ['handout-3', 'Print Handout, 3 per Page', undefined],
    ['handout-6', 'Print Handout, 6 per Page', undefined],
  ] as const
).map(([layout, label, shortcut]) => ({
  id: `print.${layout}`,
  label,
  group: 'file' as const,
  ...(shortcut === undefined ? {} : { shortcut }),
  isEnabled: () => (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
  run: () => {
    useViewStore.getState().setPrintLayout(layout)
    // A frame for the layout to reach the page before the dialog freezes it.
    requestAnimationFrame(() => {
      window.print()
    })
  },
}))

/**
 * The deck as pictures.
 *
 * SVG is what the app draws, written out; PNG and JPEG are that put through the
 * browser's own rasteriser. Whether an engine will rasterise the HTML inside a
 * `foreignObject` — which is where a slide's text lives — is a question about
 * the engine, so a failure is said out loud rather than written to disk as a
 * blank picture.
 */
export const exportCommands: readonly Command[] = [
  {
    id: 'export.odp',
    label: 'Export as OpenDocument\u2026',
    group: 'file',
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void exportOdp()
    },
  },
  {
    id: 'export.thmx',
    label: 'Save Theme\u2026',
    group: 'file',
    keywords: ['theme', 'thmx', 'palette', 'master'],
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void exportTheme()
    },
  },
  {
    id: 'export.video',
    label: 'Export as Video\u2026',
    group: 'file',
    keywords: ['film', 'movie', 'mp4', 'record'],
    isEnabled: () =>
      isTauri() &&
      (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0 &&
      useViewStore.getState().recordingVideo === null,
    run: () => {
      void exportVideoFile()
    },
  },
  {
    id: 'export.svg',
    label: 'Export Slide as SVG…',
    group: 'file',
    isEnabled: () => isTauri() && currentSlide(useDeckStore.getState()) !== null,
    run: () => {
      void exportCurrent('svg')
    },
  },
  {
    id: 'export.png',
    label: 'Export Slide as PNG…',
    group: 'file',
    isEnabled: () => isTauri() && currentSlide(useDeckStore.getState()) !== null,
    run: () => {
      void exportCurrent('png')
    },
  },
  {
    id: 'export.jpeg',
    label: 'Export Slide as JPEG…',
    group: 'file',
    isEnabled: () => isTauri() && currentSlide(useDeckStore.getState()) !== null,
    run: () => {
      void exportCurrent('jpeg')
    },
  },
  {
    id: 'export.png-all',
    label: 'Export Every Slide as PNG…',
    group: 'file',
    isEnabled: () => isTauri() && (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
    run: () => {
      void exportEvery('png')
    },
  },
  {
    id: 'export.jpeg-all',
    label: 'Export Every Slide as JPEG…',
    group: 'file',
    isEnabled: () => isTauri() && (useDeckStore.getState().open?.deck.slides.length ?? 0) > 0,
    run: () => {
      void exportEvery('jpeg')
    },
  },
]

type Picture = 'svg' | 'png' | 'jpeg'

const MIME: Record<'png' | 'jpeg', RasterType> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
}

/** The bytes of one slide in one format. */
async function pictureOf(slide: Slide, kind: Picture): Promise<Uint8Array> {
  const { open } = useDeckStore.getState()
  if (open === null) throw new Error('nothing is open')

  const markup = slideSvg(open.deck, slide, open.themes, open.package)
  if (kind === 'svg') return new TextEncoder().encode(markup)

  // Twice the slide's own size in points, which is about 144 dpi: a slide is
  // usually looked at on a screen, and a picture of one that is soft is worse
  // than one that is large.
  const size = {
    width: open.deck.slideSize.width / 12700,
    height: open.deck.slideSize.height / 12700,
  }
  return rasterise(markup, size, MIME[kind], 2)
}

async function exportCurrent(kind: Picture): Promise<void> {
  const slide = currentSlide(useDeckStore.getState())
  const { open } = useDeckStore.getState()
  if (slide === null || open === null) return

  const suggested = pictureName(nameOf(open.path ?? 'Presentation.pptx'), 0, 1, kind)
  const path = await pickExportPath(suggested, kind)
  if (path === null) return

  try {
    await writeFileBytes(path, await pictureOf(slide, kind))
  } catch (cause) {
    useDeckStore.setState({ error: cause instanceof Error ? cause.message : 'the export failed' })
  }
}

async function exportEvery(kind: 'png' | 'jpeg'): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  const directory = await pickDirectory()
  if (directory === null) return

  const name = nameOf(open.path ?? 'Presentation.pptx')

  try {
    for (const [index, slide] of open.deck.slides.entries()) {
      const file = pictureName(name, index, open.deck.slides.length, kind)
      await writeFileBytes(`${directory}/${file}`, await pictureOf(slide, kind))
    }
  } catch (cause) {
    useDeckStore.setState({ error: cause instanceof Error ? cause.message : 'the export failed' })
  }
}

export const zoomCommands: readonly Command[] = [
  {
    id: 'view.master',
    label: 'Slide Master',
    group: 'view',
    isActive: () => useDeckStore.getState().master !== null,
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { open, current, master, showMaster, select } = useDeckStore.getState()
      if (master !== null) {
        // Back to the slide that was on screen, not to the first one.
        select(current)
        return
      }

      // Into the layout the slide being shown is built on, which is the one a
      // person opening this view almost always meant.
      const here = open?.deck.slides[current]
      const first = [...(open?.deck.masters.keys() ?? [])][0]
      const start = here?.layout ?? first ?? null
      if (start !== null) showMaster(start)
    },
  },
  {
    id: 'view.rulers',
    label: 'Rulers and Guides',
    group: 'view',
    isActive: () => useViewStore.getState().rulers,
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const view = useViewStore.getState()
      view.setRulers(!view.rulers)
    },
  },
  {
    id: 'view.grid',
    label: 'Gridlines',
    group: 'view',
    isActive: () => useViewStore.getState().grid,
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const view = useViewStore.getState()
      view.setGrid(!view.grid)
    },
  },
  {
    id: 'view.snap-to-grid',
    label: 'Snap to Grid',
    group: 'view',
    // Apart from showing it, as in PowerPoint: wanting things lined up and
    // wanting to look at the lines are two different wishes.
    isActive: () => useViewStore.getState().snapToGrid,
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const view = useViewStore.getState()
      view.setSnapToGrid(!view.snapToGrid)
    },
  },
  {
    id: 'view.grid-and-guides',
    label: 'Grid and Guides…',
    group: 'view',
    // Where PowerPoint keeps the same four answers, which is the reason to put
    // them here rather than to invent a place of our own.
    keywords: ['grid', 'guides', 'snap', 'spacing'],
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useViewStore.getState().setEditingGrid(true)
    },
  },
  {
    id: 'view.outline',
    label: 'Outline View',
    group: 'view',
    isActive: () => useViewStore.getState().leftPane === 'outline',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const view = useViewStore.getState()
      view.setLeftPane(view.leftPane === 'outline' ? 'filmstrip' : 'outline')
      if (!view.panels.filmstrip) view.togglePanel('filmstrip')
    },
  },
  {
    id: 'view.zoom-in',
    label: 'Zoom In',
    group: 'view',
    shortcut: 'Mod+=',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { zoom, setZoom } = useViewStore.getState()
      // From fitted, the first step out is life size rather than a guess at
      // whatever the window happened to be showing.
      setZoom((zoom ?? 1) * 1.25)
    },
  },
  {
    id: 'view.zoom-out',
    label: 'Zoom Out',
    group: 'view',
    shortcut: 'Mod+-',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      const { zoom, setZoom } = useViewStore.getState()
      setZoom((zoom ?? 1) / 1.25)
    },
  },
  {
    id: 'view.zoom-fit',
    label: 'Fit to Window',
    group: 'view',
    shortcut: 'Mod+0',
    isActive: () => useViewStore.getState().zoom === null,
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useViewStore.getState().setZoom(null)
    },
  },
]

export const spacingCommands: readonly Command[] = (
  [
    ['single', 'Single Spacing', 1],
    ['one-and-a-half', 'One and a Half Spacing', 1.5],
    ['double', 'Double Spacing', 2],
  ] as const
).map(([id, label, multiple]) => ({
  id: `format.spacing-${id}`,
  label,
  group: 'format' as const,
  isActive: () => paragraphAttribute('lineSpacing') === multiple,
  isEnabled: () => useEditorStore.getState().editor !== null,
  run: () => {
    // Choosing the spacing a paragraph already has clears it, which puts the
    // inherited one back — the same as alignment and for the same reason.
    setParagraph({
      lineSpacing: paragraphAttribute('lineSpacing') === multiple ? null : multiple,
    })
  },
}))

export const connectorCommands: readonly Command[] = [
  {
    id: 'insert.connector',
    label: 'Connect Shapes',
    group: 'insert',
    // Exactly two: three shapes do not say which pair to join, and the command
    // greys out rather than picking for you.
    isEnabled: () => useDeckStore.getState().selection.length === 2,
    run: () => {
      const { selection, edit, selectShapes } = useDeckStore.getState()
      const made: { id: number | null } = { id: null }

      edit((slide) => {
        // In the order they were selected, so the arrow runs the way it was drawn.
        const [from, to] = selection.flatMap((id) =>
          slide.shapes.filter((shape) => shape.id === id),
        )
        if (from === undefined || to === undefined) return false

        made.id = insertConnector(slide, { from, to })
        return made.id !== null
      })

      if (made.id !== null) selectShapes([made.id])
    },
  },
]

export const tableCommands: readonly Command[] = [
  {
    id: 'insert.table',
    label: 'Table…',
    group: 'insert',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useViewStore.getState().setChoosingTable(true)
    },
  },
]

/**
 * The format painter, as two halves of one gesture.
 *
 * PowerPoint arms a button and waits for a click on a shape. Two commands do
 * the same work from the keyboard, the menu and the palette, and this app
 * already has an armed pointer for drawing — a second mode to get stuck in is
 * one more than it needs.
 */
export const painterCommands: readonly Command[] = [
  {
    id: 'format.copy-formatting',
    label: 'Copy Formatting',
    group: 'format',
    shortcut: 'Mod+Alt+C',
    keywords: ['painter', 'brush', 'style'],
    isEnabled: () => useDeckStore.getState().selection.length > 0,
    isActive: () => heldFormat() !== null,
    run: () => {
      copyFormatting()
    },
  },
  {
    id: 'format.paste-formatting',
    label: 'Paste Formatting',
    group: 'format',
    shortcut: 'Mod+Alt+V',
    keywords: ['painter', 'brush', 'apply'],
    isEnabled: () => heldFormat() !== null && useDeckStore.getState().selection.length > 0,
    run: () => {
      pasteFormatting()
    },
  },
]

export const reviewCommands: readonly Command[] = [
  {
    id: 'review.compare',
    label: 'Compare with Another Deck\u2026',
    group: 'view',
    keywords: ['review', 'changes', 'accept', 'merge'],
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void startReview()
    },
  },
]

export const commentCommands: readonly Command[] = [
  {
    id: 'review.comments',
    label: 'Comments',
    group: 'view',
    shortcut: 'Mod+Alt+m',
    keywords: ['review', 'remark', 'note'],
    isEnabled: () => useDeckStore.getState().open !== null,
    isActive: () => useViewStore.getState().commenting,
    run: () => {
      const view = useViewStore.getState()
      view.setCommenting(!view.commenting)
    },
  },
]

/** The one thing to do to a diagram: stop it being one. */
export const diagramCommands: readonly Command[] = [
  {
    id: 'format.convert-diagram',
    label: 'Convert SmartArt to Shapes',
    group: 'format',
    keywords: ['smartart', 'diagram', 'ungroup'],
    isEnabled: () => selectedDiagram() !== null,
    run: () => {
      const { open } = useDeckStore.getState()
      const slide = currentSlide(useDeckStore.getState())
      if (open === null || slide === null) return

      const made: { id: number | null } = { id: null }
      useDeckStore.getState().editPackage((deck) => {
        const part = deck.deck.slides[useDeckStore.getState().current]
        const frame = part?.shapes.find((one) => one.id === selectedDiagram())
        if (part === undefined || frame === undefined) return false

        made.id = convertDiagramToShapes(deck.package, part, frame)
        if (made.id !== null) writeSlidePart(deck.package, part)
        return made.id !== null
      })

      if (made.id !== null) useDeckStore.getState().selectShapes([made.id])
    },
  },
]

/** The selected shape's id, when it is a diagram we could draw. */
function selectedDiagram(): number | null {
  const state = useDeckStore.getState()
  const slide = currentSlide(state)
  if (state.open === null || slide === null || state.selection.length !== 1) return null

  const shape = slide.shapes.find((one) => state.selection.includes(one.id))
  if (shape?.graphic?.kind !== 'diagram') return null

  // A diagram nobody has opened in PowerPoint has no picture to convert into,
  // and offering the command would be offering to make an empty group.
  return diagramDrawingPart(state.open.package, slide.path, shape.graphic.relationshipId) === null
    ? null
    : shape.id
}

export const footerCommands: readonly Command[] = [
  {
    id: 'insert.header-footer',
    label: 'Header and Footer…',
    group: 'insert',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useViewStore.getState().setEditingFooters(true)
    },
  },
]

export const shapeGalleryCommand: Command = {
  id: 'insert.shape',
  label: 'Shape…',
  group: 'insert',
  isEnabled: () => useDeckStore.getState().open !== null,
  run: () => {
    useViewStore.getState().setChoosingShape(true)
  },
}

export const insertCommands: readonly Command[] = PRESETS.map(([preset, label]) => ({
  id: `insert.${preset}`,
  label,
  group: 'insert' as const,
  isEnabled: () => useDeckStore.getState().open !== null,
  run: () => {
    const { open, edit, selectShapes } = useDeckStore.getState()
    const size = open?.deck.slideSize ?? { width: 0, height: 0 }
    const made: { id: number | null } = { id: null }

    // Centred on the slide at a size that reads at any slide dimension: drawing
    // it out with the pointer comes later, and a shape that appears somewhere
    // arbitrary is worse than one that appears where you are looking.
    const width = size.width / 4
    const height = preset === 'line' ? 0 : size.height / 4

    edit((slide) => {
      made.id = createShape(slide, {
        preset,
        transform: {
          x: (size.width - width) / 2,
          y: (size.height - height) / 2,
          width,
          height,
        },
      })
      return true
    })

    if (made.id !== null) selectShapes([made.id])
  },
}))

/**
 * The icons the app ships with, each its own command.
 *
 * Inserted as custom geometry rather than as a picture: an icon that is a shape
 * fills from the theme, stays sharp at any size, and every tool that already
 * knows what to do with a shape knows what to do with it.
 */
export const iconCommands: readonly Command[] = ICONS.map((icon) => ({
  id: `insert.icon.${icon.id}`,
  label: `${icon.label} Icon`,
  group: 'insert' as const,
  isEnabled: () => useDeckStore.getState().open !== null,
  run: () => {
    const { open, edit, selectShapes } = useDeckStore.getState()
    const size = open?.deck.slideSize ?? { width: 0, height: 0 }
    const made: { id: number | null } = { id: null }

    // Square, and about an inch at any slide size: an icon has no proportions
    // of its own to respect beyond the box it was drawn in.
    const side = Math.min(size.width, size.height) / 6

    edit((slide) => {
      made.id = insertIcon(slide, {
        name: `${icon.label} Icon`,
        paths: icon.paths,
        size: ICON_SIZE,
        transform: {
          x: (size.width - side) / 2,
          y: (size.height - side) / 2,
          width: side,
          height: side,
        },
      })
      return true
    })

    if (made.id !== null) selectShapes([made.id])
  },
}))

/** Putting a picture on the slide, through the one place that does that. */
async function insertPictureFromDisk(): Promise<void> {
  const path = await pickPicturePath()
  if (path === null) return

  insertPictureOnSlide(nameOf(path), await readFileBytes(path))
}

export const groupCommands: readonly Command[] = [
  {
    id: 'format.group',
    label: 'Group',
    group: 'format',
    shortcut: 'Mod+g',
    // One shape is not a group; the command says so rather than making one.
    isEnabled: () => useDeckStore.getState().selection.length > 1,
    run: () => {
      const { edit, selectShapes } = useDeckStore.getState()
      // Held in an object because a `let` assigned inside the callback is
      // narrowed to its initial value by the time it is read again.
      const made: { id: number | null } = { id: null }

      edit((slide) => {
        made.id = groupShapes(slide, selected(slide))
        return made.id !== null
      })

      // The group becomes the selection, as it does in PowerPoint: what was
      // just made is what the next action is about.
      if (made.id !== null) selectShapes([made.id])
    },
  },
  {
    id: 'format.ungroup',
    label: 'Ungroup',
    group: 'format',
    shortcut: 'Mod+Shift+g',
    isEnabled: () => {
      const { open, current, selection } = useDeckStore.getState()
      const shapes = open?.deck.slides[current]?.shapes ?? []
      return shapes.some((shape) => selection.includes(shape.id) && shape.kind === 'grpSp')
    },
    run: () => {
      const { edit, selectShapes } = useDeckStore.getState()
      const freed: number[] = []

      edit((slide) =>
        selected(slide)
          .filter((shape) => shape.kind === 'grpSp')
          .map((group) => {
            freed.push(...group.shapes.map((child) => child.id))
            return ungroupShape(slide, group)
          })
          .reduce((changed: boolean, one) => changed || one, false),
      )

      if (freed.length > 0) selectShapes(freed)
    },
  },
]

/** The four z-order moves, which are all the same call. */
export const arrangeCommands: readonly Command[] = (
  [
    ['front', 'Bring to Front'],
    ['forward', 'Bring Forward'],
    ['backward', 'Send Backward'],
    ['back', 'Send to Back'],
  ] as const
).map(([move, label]) => ({
  id: `format.${move}`,
  label,
  group: 'format' as const,
  isEnabled: () => useDeckStore.getState().selection.length > 0,
  run: () => {
    const { selection, edit } = useDeckStore.getState()
    edit((slide) =>
      reorderShapes(
        slide,
        slide.shapes.filter((shape) => selection.includes(shape.id)),
        move,
      ),
    )
  },
}))

export const viewCommands: readonly Command[] = [
  {
    id: 'view.filmstrip',
    label: 'Slide Panel',
    group: 'view',
    isActive: () => useViewStore.getState().panels.filmstrip,
    run: () => {
      useViewStore.getState().togglePanel('filmstrip')
    },
  },
  {
    id: 'view.properties',
    label: 'Format Panel',
    group: 'view',
    isActive: () => useViewStore.getState().panels.properties,
    run: () => {
      useViewStore.getState().togglePanel('properties')
    },
  },
  {
    id: 'view.notes',
    label: 'Notes',
    group: 'view',
    isActive: () => useViewStore.getState().panels.notes,
    run: () => {
      useViewStore.getState().togglePanel('notes')
    },
  },
]

export const appearanceCommands: readonly Command[] = (['dark', 'light', 'system'] as const).map(
  (theme) => ({
    id: `view.theme-${theme}`,
    label: `${theme.charAt(0).toUpperCase()}${theme.slice(1)} Theme`,
    group: 'view',
    isActive: () => useViewStore.getState().theme === theme,
    run: () => {
      useViewStore.getState().setTheme(theme)
    },
  }),
)

/** Registers every command exactly once; the reset keeps hot reload from double-registering. */
export function registerBuiltinCommands(): void {
  resetRegistry()
  registerAll(fileCommands)
  registerAll(editCommands)
  registerAll(arrangeCommands)
  registerAll(insertCommands)
  register(shapeGalleryCommand)
  registerAll(iconCommands)
  registerAll(pictureCommands)
  registerAll(tableCommands)
  registerAll(footerCommands)
  registerAll(diagramCommands)
  registerAll(commentCommands)
  registerAll(reviewCommands)
  registerAll(painterCommands)
  registerAll(connectorCommands)
  registerAll(textCommands)
  registerAll(paragraphCommands)
  registerAll(indentCommands)
  registerAll(spacingCommands)
  registerAll(slideEditCommands)
  registerAll(exportCommands)
  registerAll(printCommands)
  registerAll(showCommands)
  registerAll(zoomCommands)
  registerAll(groupCommands)
  registerAll(alignCommands)
  registerAll(tableEditCommands)
  registerAll(flipCommands)
  registerAll(distributeCommands)
  registerAll(slideCommands)
  registerAll(viewCommands)
  registerAll(appearanceCommands)
}

/** Puts a picture behind the slide, bytes and all. */
async function backgroundPictureFromDisk(): Promise<void> {
  const path = await pickPicturePath()
  if (path === null) return

  const bytes = await readFileBytes(path)
  const { editPackage } = useDeckStore.getState()

  editPackage((open) => {
    const slide = open.deck.slides[useDeckStore.getState().current]
    if (slide === undefined) return false

    const changed = writeBackgroundPicture(open.package, slide, { fileName: nameOf(path), bytes })
    if (changed) writePart(open.package, slide.path, slide.root)
    return changed
  })
}

/**
 * Starts the show, on a screen of its own where there is one.
 *
 * A separate window is the right answer — the editor keeps its own place, and a
 * second screen can hold the presenter view — but it is also the answer that
 * can fail: no Tauri, no second window, a deck that will not write out. Every
 * one of those falls back to showing it here, because a presentation that does
 * not start is worse than one on the wrong screen.
 */
async function present(at: number, rehearsing = false, recording = false): Promise<void> {
  const { open } = useDeckStore.getState()
  if (open === null) return

  // A rehearsal stays in this window: the point is the numbers at the end, and
  // a second window would take them somewhere this one cannot read them.
  // A rehearsal or a recording stays in this window: the point is what comes
  // back at the end, and a second window would take it somewhere this one
  // cannot read it.
  if (isTauri() && !rehearsing && !recording) {
    try {
      // Whether a presenter view came with it or not, the show is on its own
      // screen and this window has nothing to add.
      await openShowWindows(await saveDeck(open.package), at)
      return
    } catch {
      // Fall through to the show in this window.
    }
  }

  // In a browser there is one window, and writing the deck out to hand it to
  // nobody would be a copy made for nothing.
  useShowStore
    .getState()
    .start(at, open.deck.slides.length, stepsPerSlide(open.deck), rehearsing, recording)
  await enterFullScreen()
}

/**
 * Fills the screen for the show, where there is a window to ask.
 *
 * In a browser there is none, and the show is simply the size of the page;
 * nothing else about it depends on the answer, so a failure here is not worth
 * stopping a presentation over.
 */
async function enterFullScreen(): Promise<void> {
  if (!isTauri()) return

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setFullscreen(true)
  } catch {
    // A show at window size is a show.
  }
}

/** Gives the window back when the show ends. */
export async function leaveFullScreen(): Promise<void> {
  if (!isTauri()) return

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setFullscreen(false)
  } catch {
    // Nothing to give back.
  }
}
