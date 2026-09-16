import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag handles for resizing an image.
 *
 * The aspect ratio is locked: an image stretched out of proportion is almost
 * never what the user meant, and Word's corner handles behave the same way.
 * Sizes are in points, matching the document model rather than screen pixels.
 */
export function ImageResizer({ node, updateAttributes, selected }: NodeViewProps) {
  const width = typeof node.attrs['width'] === 'number' ? node.attrs['width'] : 0
  const height = typeof node.attrs['height'] === 'number' ? node.attrs['height'] : 0
  const src = typeof node.attrs['src'] === 'string' ? node.attrs['src'] : ''
  const alt = typeof node.attrs['alt'] === 'string' ? node.attrs['alt'] : ''
  const wrap = typeof node.attrs['wrap'] === 'string' ? node.attrs['wrap'] : 'inline'

  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, width: 0, ratio: 1 })

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      start.current = { x: event.clientX, width, ratio: width > 0 ? height / width : 1 }
      setDragging(true)
    },
    [height, width],
  )

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: PointerEvent) => {
      // Screen pixels to points; the document is laid out in points.
      const delta = (event.clientX - start.current.x) * (72 / 96)
      const next = Math.max(12, Math.round((start.current.width + delta) * 10) / 10)

      updateAttributes({
        width: next,
        height: Math.round(next * start.current.ratio * 10) / 10,
      })
    }

    const onUp = () => {
      setDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, updateAttributes])

  return (
    <NodeViewWrapper as="span" className="document-image" data-selected={selected} data-wrap={wrap}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={width > 0 ? { width: `${String(width)}pt` } : undefined}
      />

      {selected && (
        <button
          type="button"
          aria-label="Resize image"
          onPointerDown={onPointerDown}
          className="document-image-handle"
        />
      )}
    </NodeViewWrapper>
  )
}
