import { Extension } from '@tiptap/core'
import { withoutStop, withStop } from '../../ooxml/tabs'
import type { TabStop } from '../../ooxml/tabs'

/**
 * Tab stops on the paragraph.
 *
 * Where a tab lands, and what fills the gap it leaves. A dotted leader is what
 * makes a hand-written contents line up, and it is the stop that carries it —
 * the tab character itself says nothing about where it is going.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tabStops: {
      /** Adds a stop, replacing one already at that position. */
      setTabStop: (stop: TabStop) => ReturnType
      clearTabStop: (position: number) => ReturnType
      clearTabStops: () => ReturnType
    }
  }
}

export interface TabStopsOptions {
  types: string[]
}

/** The stops of the block the cursor is in. */
export function tabStopsOf(attributes: Record<string, unknown>): TabStop[] {
  const stops = attributes['tabs']
  return Array.isArray(stops) ? (stops as TabStop[]) : []
}

export const TabStops = Extension.create<TabStopsOptions>({
  name: 'tabStops',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          tabs: {
            default: null,
            // Nothing in the DOM stands for a tab stop; the ruler draws them.
            renderHTML: () => ({}),
            parseHTML: () => null,
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setTabStop:
        (stop) =>
        ({ editor, commands }) =>
          this.options.types.every((type) =>
            editor.isActive(type)
              ? commands.updateAttributes(type, {
                  tabs: withStop(tabStopsOf(editor.getAttributes(type)), stop),
                })
              : true,
          ),

      clearTabStop:
        (position) =>
        ({ editor, commands }) =>
          this.options.types.every((type) => {
            if (!editor.isActive(type)) return true

            const stops = withoutStop(tabStopsOf(editor.getAttributes(type)), position)
            // An empty list is stored as nothing, so the paragraph goes back to
            // saying it has no stops of its own rather than that it has none.
            return commands.updateAttributes(type, { tabs: stops.length > 0 ? stops : null })
          }),

      clearTabStops:
        () =>
        ({ editor, commands }) =>
          this.options.types.every((type) =>
            editor.isActive(type) ? commands.updateAttributes(type, { tabs: null }) : true,
          ),
    }
  },
})
