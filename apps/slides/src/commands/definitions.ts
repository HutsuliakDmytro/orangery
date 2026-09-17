import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import {
  nameOf,
  pickDeckPath,
  pickPicturePath,
  readDeckFile,
  readFileBytes,
} from '../document/file'
import {
  alignmentBounds,
  alignShapes,
  createShape,
  deleteShapes,
  insertConnector,
  insertPicture,
  insertTable,
  distributeShapes,
  duplicateShape,
  groupShapes,
  moveShape,
  reorderShapes,
  ungroupShape,
} from '@orangery/ooxml-presentation'
import type { Alignment, Shape, Slide } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * What Slides can do so far.
 *
 * The registry is the single source of actions: whatever is here appears in the
 * native menu and the command palette without either being told separately
 * (`apps/docs/docs/adr/0002-command-registry.md`).
 *
 * A command that is not implemented yet is registered disabled rather than left
 * out. The menu is the shape of the application: a File menu with nothing in it
 * says the app cannot open a deck at all, while a greyed-out Save says it
 * cannot do so yet.
 */

const notYet = (id: string, label: string, shortcut?: string): Command => ({
  id,
  label,
  group: 'file',
  ...(shortcut === undefined ? {} : { shortcut }),
  isEnabled: () => false,
  run: () => {
    // Deliberately nothing: `isEnabled` keeps this unreachable from every
    // surface, and a stub that half-worked would be worse than one that does not.
  },
})

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
      void openDeck()
    },
  },
  {
    id: 'file.close',
    label: 'Close Presentation',
    group: 'file',
    shortcut: 'Mod+w',
    isEnabled: () => useDeckStore.getState().open !== null,
    run: () => {
      useDeckStore.getState().close()
    },
  },
  notYet('file.new', 'New Presentation', 'Mod+n'),
  notYet('file.save', 'Save', 'Mod+s'),
]

async function openDeck(): Promise<void> {
  const path = await pickDeckPath()
  if (path === null) return

  await useDeckStore.getState().load(await readDeckFile(path), path)
  document.title = `${nameOf(path)} — Orangery Slides`
}

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
    id: 'edit.leave-text',
    label: 'Finish Editing Text',
    group: 'edit',
    shortcut: 'Escape',
    // At the window rather than inside the editor: Escape should leave the
    // shape wherever the focus happens to be.
    isEnabled: () => useDeckStore.getState().editing !== null,
    run: () => {
      useDeckStore.getState().setEditing(null)
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
    id: 'insert.picture',
    label: 'Picture…',
    group: 'insert',
    isEnabled: () => isTauri() && useDeckStore.getState().open !== null,
    run: () => {
      void insertPictureFromDisk()
    },
  },
]

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
      const { open, edit, selectShapes } = useDeckStore.getState()
      const size = open?.deck.slideSize ?? { width: 0, height: 0 }
      if (open === null) return

      // Three by three across most of the slide, which is what PowerPoint's
      // own dialogue starts at; choosing the size comes with the grid picker.
      const width = size.width * 0.8
      const height = size.height * 0.4
      const made: { id: number | null } = { id: null }

      edit((slide) => {
        made.id = insertTable(open.package, slide, {
          rows: 3,
          columns: 3,
          transform: {
            x: (size.width - width) / 2,
            y: (size.height - height) / 2,
            width,
            height,
          },
        })
        return made.id !== null
      })

      if (made.id !== null) selectShapes([made.id])
    },
  },
]

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
 * Putting a picture on the slide.
 *
 * Sized to a quarter of the slide's width and the shape of the file, which
 * needs the picture measured; until that is wired up it goes in square and can
 * be resized, which is better than guessing an aspect ratio and being wrong.
 */
async function insertPictureFromDisk(): Promise<void> {
  const path = await pickPicturePath()
  if (path === null) return

  const bytes = await readFileBytes(path)
  const { open, current, edit, selectShapes } = useDeckStore.getState()
  const size = open?.deck.slideSize ?? { width: 0, height: 0 }
  const slide = open?.deck.slides[current]
  if (open === null || slide === undefined) return

  const side = size.width / 4
  const made: { id: number | null } = { id: null }

  edit((edited) => {
    made.id = insertPicture(open.package, edited, {
      fileName: nameOf(path),
      bytes,
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
  registerAll(pictureCommands)
  registerAll(tableCommands)
  registerAll(connectorCommands)
  registerAll(groupCommands)
  registerAll(alignCommands)
  registerAll(distributeCommands)
  registerAll(slideCommands)
  registerAll(viewCommands)
  registerAll(appearanceCommands)
}
