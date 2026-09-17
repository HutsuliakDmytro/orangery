import { EditorContent, useCurrentEditor } from '@tiptap/react'
import type { CSSProperties } from 'react'
import { contentWidth } from '../ooxml/section'
import { useViewStore } from '../store/view-store'

/**
 * The document page.
 *
 * A white sheet on a grey background at the page's real size, scaled by the zoom
 * — the familiar Word/Docs presentation. Real page-flow layout is post-MVP
 * (CLAUDE.md "Known hard problems"), so this is one continuous sheet with the
 * correct width and margins rather than a stack of paginated pages.
 */
export function EditorSurface() {
  const { editor } = useCurrentEditor()
  const zoom = useViewStore((state) => state.zoom)
  const section = useViewStore((state) => state.section)

  /**
   * Text columns, drawn only for a document that is a single section.
   *
   * CSS lays out columns on a container, and a section is a run of blocks with
   * no container of its own — so a document that changes column layout part-way
   * through cannot be drawn this way. It still round-trips: the file keeps what
   * each section says, and Word lays it out. See `PLAN.md`, phase 4.5.3.
   */
  const columns = editor?.state.doc.content.content.some(
    (node) => node.type.name === 'sectionBreak',
  )
    ? null
    : section.columns

  // Passed down as custom properties rather than set on the element: the
  // children that flow into columns are the paragraphs, so the layout belongs
  // on the editable itself, which React does not render.
  const columnStyle = {
    '--page-columns': columns === null ? 'auto' : String(columns.count),
    '--page-column-gap': `${String(columns?.spacing ?? 0)}pt`,
    '--page-column-rule': columns?.separator === true ? '1px solid #cccccc' : 'none',
  }

  return (
    <div className="h-full overflow-auto bg-surface-2 py-8">
      <div
        className="document-page relative mx-auto bg-page shadow-lg"
        style={
          {
            // Points map to CSS pixels at 96dpi via the 1.333 factor; using pt
            // directly keeps the page the size it will print at.
            width: `${String(section.width)}pt`,
            minHeight: `${String(section.height)}pt`,
            paddingTop: `${String(section.margins.top)}pt`,
            paddingRight: `${String(section.margins.right)}pt`,
            paddingBottom: `${String(section.margins.bottom)}pt`,
            paddingLeft: `${String(section.margins.left + section.margins.gutter)}pt`,
            // Read by the page-gap widget, which has to reproduce the margins at
            // every break rather than only at the end of the sheet.
            '--page-margin-top': `${String(section.margins.top)}pt`,
            '--page-margin-bottom': `${String(section.margins.bottom)}pt`,
            '--page-margin-left': `${String(section.margins.left + section.margins.gutter)}pt`,
            '--page-margin-right': `${String(section.margins.right)}pt`,
            ...columnStyle,
            transform: `scale(${String(zoom)})`,
            // Scaling from the top keeps the page under the ruler as zoom changes.
            transformOrigin: 'top center',
            // `scale` does not affect layout, so the wrapper reserves the scaled
            // height itself; without this the scroll area is wrong at every zoom
            // except 100%.
            marginBottom: `${String(section.height * (zoom - 1))}pt`,
            // React's CSSProperties does not admit custom properties.
          } as CSSProperties
        }
      >
        <EditorContent editor={editor} style={{ maxWidth: `${String(contentWidth(section))}pt` }} />
      </div>
    </div>
  )
}
