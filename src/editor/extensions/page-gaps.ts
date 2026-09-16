import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { contentHeight } from '../../ooxml/section'
import { useViewStore } from '../../store/view-store'

/**
 * Approximate page breaks, drawn as a real gap between blocks.
 *
 * ProseMirror has no page-flow layout, so this is not true pagination — the
 * breaks land at block boundaries rather than mid-paragraph, and a very tall
 * block overshoots (CLAUDE.md "Known hard problems").
 *
 * The gap is a widget decoration *between* blocks rather than an overlay drawn
 * on top. An overlay is simpler, but it either hides the text underneath it or
 * reads as a hairline that nobody recognises as a page break. A widget occupies
 * real space, so no text ever falls into the gap.
 */

export const pageGapsKey = new PluginKey<DecorationSet>('pageGaps')

/** The desk showing between two sheets, in CSS pixels. Matches `editor.css`. */
export const PAGE_GAP_PX = 24

const POINTS_TO_PIXELS = 96 / 72

/**
 * Positions at which a page ends, given the top-level blocks and their heights.
 *
 * Returns document positions, so the caller can attach a widget before the block
 * that starts the next page. Exported for testing: the geometry is the part
 * worth checking, and it needs no DOM.
 */
export function breakPositions(
  blocks: readonly { position: number; top: number; height: number; forced?: boolean }[],
  pageHeightPx: number,
): number[] {
  if (pageHeightPx <= 0 || blocks.length === 0) return []

  const positions: number[] = []
  // Where the current page begins. A block that does not fit below it starts the
  // next one, and that page then begins at the block's own top.
  let pageTop = 0

  for (const block of blocks) {
    // The first block cannot be moved anywhere, however tall it is: a break
    // before it would put a gap above the document.
    if (block.top <= pageTop) continue

    // A paragraph that asks for a page before it gets one whether or not the
    // page it sits on is full.
    if (block.forced) {
      positions.push(block.position)
      pageTop = block.top
      continue
    }

    if (block.top + block.height > pageTop + pageHeightPx) {
      positions.push(block.position)
      pageTop = block.top
    }
  }

  return positions
}

/** Outer height of an element, margins included. */
function outerHeight(element: HTMLElement): number {
  const style = getComputedStyle(element)
  return (
    element.offsetHeight +
    Number.parseFloat(style.marginTop || '0') +
    Number.parseFloat(style.marginBottom || '0')
  )
}

function buildDecorations(view: EditorView, pageHeightPx: number): DecorationSet {
  const blocks: { position: number; top: number; height: number; forced?: boolean }[] = []
  const { doc } = view.state

  // The page's own top padding is the top margin of the sheet, not content, so
  // it is taken off every measurement.
  const paddingTop = Number.parseFloat(getComputedStyle(view.dom).paddingTop || '0')

  // Gaps already in the layout occupy space that is not document content, so
  // their measured height is subtracted from everything below them. Read from
  // the DOM rather than assumed: a constant that disagrees with the stylesheet
  // makes the break move on every re-measure.
  let gapHeight = 0

  doc.forEach((node, nodePosition) => {
    const dom = view.nodeDOM(nodePosition)
    if (!(dom instanceof HTMLElement)) return

    const previous = dom.previousElementSibling
    if (previous instanceof HTMLElement && previous.classList.contains('page-gap')) {
      gapHeight += outerHeight(previous)
    }

    blocks.push({
      position: nodePosition,
      top: dom.offsetTop - paddingTop - gapHeight,
      height: dom.offsetHeight,
      ...(node.attrs['pageBreakBefore'] === true ? { forced: true } : {}),
    })
  })

  const positions = breakPositions(blocks, pageHeightPx)
  padLastPage(view, blocks, positions, pageHeightPx)

  return DecorationSet.create(
    doc,
    positions.map((position, index) =>
      Decoration.widget(
        position,
        () => {
          // Three stacked bands, because a page break is not just a gap: the
          // page above ends with its bottom margin and the page below starts
          // with its top margin. Without them the text runs straight into the
          // desk and its descenders are clipped.
          const element = document.createElement('div')
          element.className = 'page-gap'
          element.setAttribute('contenteditable', 'false')

          const bottomMargin = document.createElement('div')
          bottomMargin.className = 'page-gap-margin'

          const band = document.createElement('div')
          band.className = 'page-gap-band'

          const label = document.createElement('span')
          label.className = 'page-gap-label'
          label.textContent = `Page ${String(index + 2)}`
          band.append(label)

          const topMargin = document.createElement('div')
          topMargin.className = 'page-gap-margin'

          element.append(bottomMargin, band, topMargin)
          return element
        },
        // Placed before the block, and never treated as part of the selection.
        { side: -1, ignoreSelection: true, key: `page-gap-${String(position)}` },
      ),
    ),
  )
}

export const PageGaps = Extension.create({
  name: 'pageGaps',

  addProseMirrorPlugins() {
    let frame: number | null = null

    return [
      new Plugin<DecorationSet>({
        key: pageGapsKey,

        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const next = tr.getMeta(pageGapsKey) as DecorationSet | undefined
            if (next) return next
            // Positions are mapped through edits so the gaps do not jump while
            // the measurement for the new layout is still pending.
            return value.map(tr.mapping, tr.doc)
          },
        },

        props: {
          decorations: (state) => pageGapsKey.getState(state),
        },

        view(view) {
          const measure = () => {
            frame = null

            const section = useViewStore.getState().section
            const pageHeightPx = contentHeight(section) * POINTS_TO_PIXELS
            const decorations = buildDecorations(view, pageHeightPx)

            // Only dispatch when the set actually changed, or measuring would
            // trigger a re-measure and spin.
            const current = pageGapsKey.getState(view.state)
            if (current && sameDecorations(current, decorations, view)) return

            view.dispatch(view.state.tr.setMeta(pageGapsKey, decorations))
          }

          const schedule = () => {
            if (frame !== null) return
            frame = requestAnimationFrame(measure)
          }

          schedule()

          // The page height changes with page setup and with the font, so the
          // measurement follows the element rather than only the document.
          const observer =
            typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
          observer?.observe(view.dom)

          const unsubscribe = useViewStore.subscribe(schedule)

          return {
            update: schedule,
            destroy() {
              observer?.disconnect()
              unsubscribe()
              if (frame !== null) cancelAnimationFrame(frame)
            },
          }
        },
      }),
    ]
  },
})

/**
 * Extends the sheet so the last page is a full page tall.
 *
 * Without it the paper stops wherever the text does, which reads as a torn page
 * rather than as the end of a document.
 *
 * The padding goes on the wrapper, not on the editable element: mutating the
 * style of a `contenteditable` root collapses the selection in the browser, so
 * typing and then pressing Tab lost the cursor and did nothing.
 */
function padLastPage(
  view: EditorView,
  blocks: readonly { position: number; top: number; height: number }[],
  breaks: readonly number[],
  pageHeightPx: number,
): void {
  const wrapper = view.dom.parentElement
  if (!wrapper) return

  const last = blocks.at(-1)
  if (!last || pageHeightPx <= 0) {
    wrapper.style.paddingBottom = ''
    return
  }

  // The final page starts at the block the last break pushed down, or at the top
  // of the document when it all fits on one page.
  const lastBreak = breaks.at(-1)
  const finalPageTop =
    lastBreak === undefined ? 0 : (blocks.find((block) => block.position === lastBreak)?.top ?? 0)

  const used = last.top + last.height - finalPageTop
  const next = `${String(Math.round(Math.max(0, pageHeightPx - used)))}px`

  if (wrapper.style.paddingBottom !== next) wrapper.style.paddingBottom = next
}

/** Decoration sets have no equality, so the positions are compared instead. */
function sameDecorations(a: DecorationSet, b: DecorationSet, view: EditorView): boolean {
  const size = view.state.doc.content.size
  const left = a.find(0, size).map((decoration) => decoration.from)
  const right = b.find(0, size).map((decoration) => decoration.from)

  return left.length === right.length && left.every((value, index) => value === right[index])
}
