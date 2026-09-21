import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DocumentChartView } from '../../components/document-chart-view'

/**
 * A chart in the document.
 *
 * An atom, and a read-only one: the numbers live in a chart part of their own,
 * and nothing here edits them yet. What the node carries is the original
 * `w:drawing` — written back untouched on save — and the chart part's XML,
 * which is what gets drawn.
 */
export const DocumentChart = Node.create({
  name: 'documentChart',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      /** Into `word/_rels/document.xml.rels`, pointing at the chart part. */
      relationshipId: { default: null },
      /** Display size in points, as the document states it. */
      width: { default: null },
      height: { default: null },
      /** The original `w:drawing`, for the save that must not change it. */
      drawing: { default: null },
      /** The chart part's XML, read when the document was opened. */
      chart: { default: null },
      /** The document theme's slots as hexes, which is what colours the chart. */
      themeColors: { default: [] },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-chart]' }]
  },

  renderHTML() {
    return ['span', { 'data-chart': '' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentChartView)
  },
})
