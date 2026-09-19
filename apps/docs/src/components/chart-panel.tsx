import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { ChartProperties, applyChartEdits, readChart, themeAccents } from '@orangery/charts'
import type { ChartEdit } from '@orangery/charts'
import type { Color } from '@orangery/ooxml-drawingml'
import { useDocumentStore } from '../store/document-store'

/**
 * The controls for the chart the cursor is on.
 *
 * The same panel the deck app shows, because the chart is the same chart: a
 * `c:chartSpace` in a part of its own, whichever kind of document embeds it.
 *
 * The edit goes into the node rather than into the package. The node is what
 * the undo history holds, and the part is written from it on save — so undoing
 * a change of legend puts back the chart that gets saved, rather than showing
 * one chart and writing another.
 */
export function ChartPanel() {
  const { editor } = useCurrentEditor()
  const markDirty = useDocumentStore((state) => state.markDirty)

  const position = useEditorState({
    editor: editor ?? null,
    selector: ({ editor: instance }) => {
      const selection = instance?.state.selection
      if (!(selection instanceof NodeSelection)) return null

      return selection.node.type.name === 'documentChart' ? selection.from : null
    },
  })

  if (editor === null || position === null) return null

  const node = editor.state.doc.nodeAt(position)
  const xml = typeof node?.attrs['chart'] === 'string' ? node.attrs['chart'] : null
  const chart = xml === null ? null : readChart(xml)
  if (chart === null) return null

  // The document theme's accents, resolved when the document was opened and
  // carried in the node. A series with no colour of its own is drawn in one of
  // these, and the panel has to say so.
  const slots = Array.isArray(node?.attrs['themeColors'])
    ? (node.attrs['themeColors'] as [string, string][])
    : []
  const scheme = new Map<string, Color>(
    slots.map(([slot, hex]) => [slot, { source: { kind: 'srgb', hex }, transforms: [] }]),
  )
  const palette = themeAccents(undefined, { scheme, map: new Map() })

  const edit = (edits: readonly ChartEdit[]) => {
    const written = applyChartEdits(xml ?? '', edits)
    if (written === null) return

    // Dispatched rather than run through a focusing chain: a control in a
    // panel should not throw the caret back into the document, and `focus()`
    // is a history step of its own, so undoing one edit would take two.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'chart', written))
    markDirty()
  }

  return (
    <aside
      aria-label="Chart"
      className="w-56 shrink-0 overflow-y-auto border-l border-border bg-surface p-3"
    >
      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Chart</h2>
      <ChartProperties chart={chart} palette={palette} onEdit={edit} />
    </aside>
  )
}
