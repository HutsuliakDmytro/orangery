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
