import type { Editor } from '@tiptap/core'
import type { NewChartKind } from '@orangery/charts'
import { addChart } from '../../document/insert-chart'
import { getSession } from '../../document/session'
import { contentWidth } from '../../ooxml/section'
import { useDocumentStore } from '../../store/document-store'
import { useViewStore } from '../../store/view-store'

/**
 * Inserting a chart.
 *
 * Only into a document that has a package to put the parts in. A chart is four
 * parts pointing at each other; a document converted from Markdown has nowhere
 * for them to live, and a chart travelling as a node alone would be a chart
 * that disappears on save.
 */
export const chartActions = {
  async insert(editor: Editor, kind: NewChartKind): Promise<boolean> {
    const session = getSession()
    if (session?.kind !== 'docx') {
      useDocumentStore.getState().addWarnings([
        {
          tag: 'chart',
          message:
            'A chart can only be inserted into a Word document. Save this one as .docx first.',
        },
      ])
      return false
    }

    // Across the text and two thirds as tall, which is the shape Word gives a
    // new chart and close enough to a golden rectangle to look deliberate.
    const width = contentWidth(useViewStore.getState().section)
    const inserted = await addChart(
      session.docx.pkg,
      kind,
      { width, height: Math.round(width * 0.6) },
      Date.now() % 100000,
    )

    editor
      .chain()
      .focus()
      .insertContent({
        type: 'documentChart',
        attrs: {
          relationshipId: inserted.relationshipId,
          width: inserted.width,
          height: inserted.height,
          drawing: inserted.drawing,
          chart: inserted.chart,
          themeColors: inserted.themeColors.map(([slot, hex]) => [slot, hex]),
        },
      })
      .run()

    useDocumentStore.getState().markDirty()
    return true
  },
}
