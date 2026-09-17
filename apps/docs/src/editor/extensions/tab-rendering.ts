import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { defaultStopAfter, nextStop } from '../../ooxml/tabs'
import type { TabStop } from '../../ooxml/tabs'

/**
 * Drawing a tab as the gap it actually is.
 *
 * CSS has no tab stops: a tab character advances by whatever the browser feels
 * like, which is never where the document says. So each tab is measured after
 * layout — the same trick the page gaps use, because it is the only way to know
 * where on the line a character has landed.
 *
 * The measurement goes back into the decoration rather than onto the element.
 * ProseMirror watches the editable for changes it did not make and undoes them,
 * so a width written straight onto the span survives until the next redraw and
 * no longer.
 *
 * A right-aligned stop is measured differently: the text after the tab has to
 * *end* at the stop, so the width is what is left once that text is accounted
 * for. That is the case a table of contents is built from.
 */

export const TAB_CLASS = 'doc-tab'

const POINTS_PER_PIXEL = 72 / 96

/** What measuring found for one tab, keyed by where that tab is. */
export interface MeasuredTab {
  width: number
  leader: TabStop['leader']
}

export type TabWidths = Map<number, MeasuredTab>

interface TabState {
  decorations: DecorationSet
  widths: TabWidths
}

export const tabRenderingKey = new PluginKey<TabState>('tabRendering')

/** Encoded onto the element, so measuring needs nothing but the DOM. */
export function encodeStops(stops: readonly TabStop[]): string {
  return stops.map((stop) => `${String(stop.position)}:${stop.alignment}:${stop.leader}`).join(',')
}

export function decodeStops(encoded: string): TabStop[] {
  if (encoded === '') return []

  return encoded.split(',').flatMap((entry): TabStop[] => {
    const [position, alignment, leader] = entry.split(':')
    const value = Number.parseFloat(position ?? '')
    if (!Number.isFinite(value)) return []

    return [
      {
        position: value,
        alignment: (alignment ?? 'left') as TabStop['alignment'],
        leader: (leader ?? 'none') as TabStop['leader'],
      },
    ]
  })
}

function buildDecorations(doc: ProseMirrorNode, widths: TabWidths): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, position) => {
    if (!node.isTextblock) return true

    const stops: unknown = node.attrs['tabs']
    const encoded = encodeStops(Array.isArray(stops) ? (stops as TabStop[]) : [])

    node.forEach((child, offset) => {
      if (!child.isText) return

      const text = child.text ?? ''
      for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== '\t') continue

        const from = position + 1 + offset + index
        const measured = widths.get(from)

        decorations.push(
          Decoration.inline(from, from + 1, {
            class: TAB_CLASS,
            'data-stops': encoded,
            'data-pos': String(from),
            'data-leader': measured?.leader ?? 'none',
            ...(measured === undefined ? {} : { style: `width: ${String(measured.width)}pt` }),
          }),
        )
      }
    })

    return false
  })

  return DecorationSet.create(doc, decorations)
}

/** The block a tab sits in, whose end bounds the text after it. */
function blockOf(tab: HTMLElement): HTMLElement | null {
  const block = tab.closest('p, h1, h2, h3, h4, h5, h6, li, td, th')
  return block instanceof HTMLElement ? block : null
}

/**
 * How wide the text between this tab and the next one is.
 *
 * Measured with a range rather than by moving anything: reading the width of
 * text where it already sits costs one layout, while nudging it to find out
 * would cost one per attempt and leave the caret somewhere else.
 */
function trailingWidth(tab: HTMLElement, block: HTMLElement): number {
  const tabs = [...block.querySelectorAll(`.${TAB_CLASS}`)]
  const next = tabs[tabs.indexOf(tab) + 1]

  const range = document.createRange()
  range.setStartAfter(tab)
  if (next === undefined) range.setEnd(block, block.childNodes.length)
  else range.setEndBefore(next)

  // Measuring a range is a layout feature, and a document model without layout
  // does not have it. Nothing measured means nothing to subtract, which leaves
  // the tab at its stop rather than breaking the line.
  if (typeof range.getBoundingClientRect !== 'function') return 0

  return range.getBoundingClientRect().width
}

function measure(view: EditorView): TabWidths {
  const widths: TabWidths = new Map()

  const tabs = view.dom.querySelectorAll<HTMLElement>(`.${TAB_CLASS}`)
  if (tabs.length === 0) return widths

  // Zoom is a scale transform, so measured pixels are zoomed ones. Derived from
  // the element rather than read from the store: a number that can disagree
  // with the layout it describes puts every tab in the wrong place.
  const bounds = view.dom.getBoundingClientRect()
  const scale = view.dom.offsetWidth === 0 ? 1 : bounds.width / view.dom.offsetWidth
  if (scale === 0) return widths

  const paddingLeft = Number.parseFloat(getComputedStyle(view.dom).paddingLeft || '0')
  // Tab stops are measured from the left of the text column, which is where the
  // page margin ends — not from the paragraph's own indent.
  const columnLeft = bounds.left + paddingLeft * scale

  for (const tab of tabs) {
    const position = Number.parseInt(tab.dataset['pos'] ?? '', 10)
    if (!Number.isFinite(position)) continue

    const stops = decodeStops(tab.dataset['stops'] ?? '')
    const block = blockOf(tab)

    const offset = ((tab.getBoundingClientRect().left - columnLeft) * POINTS_PER_PIXEL) / scale
    const stop = nextStop(stops, offset)
    const target = stop?.position ?? defaultStopAfter(offset)

    let width = target - offset

    if (stop !== null && block !== null && stop.alignment !== 'left' && stop.alignment !== 'bar') {
      const trailing = (trailingWidth(tab, block) * POINTS_PER_PIXEL) / scale
      // Right-aligned text ends at the stop; centred text straddles it.
      width -= stop.alignment === 'center' ? trailing / 2 : trailing
    }

    widths.set(position, {
      // A tab never moves text backwards, however the numbers come out.
      width: Math.max(0, Math.round(width * 100) / 100),
      leader: stop?.leader ?? 'none',
    })
  }

  return widths
}

/** Whether anything moved by enough to be worth another round. */
function differs(previous: TabWidths, next: TabWidths): boolean {
  if (previous.size !== next.size) return true

  for (const [position, measured] of next) {
    const before = previous.get(position)
    if (before === undefined) return true
    if (before.leader !== measured.leader) return true
    // A twentieth of a point is finer than a screen can show, and stopping
    // there is what keeps measuring from chasing its own rounding.
    if (Math.abs(before.width - measured.width) > 0.05) return true
  }

  return false
}

export const TabRendering = Extension.create({
  name: 'tabRendering',

  addProseMirrorPlugins() {
    return [
      new Plugin<TabState>({
        key: tabRenderingKey,

        state: {
          init: (_config, state) => ({
            decorations: buildDecorations(state.doc, new Map()),
            widths: new Map(),
          }),

          apply(transaction, previous, _oldState, newState) {
            const measured = transaction.getMeta(tabRenderingKey) as TabWidths | undefined
            if (measured !== undefined) {
              return { decorations: buildDecorations(newState.doc, measured), widths: measured }
            }

            if (!transaction.docChanged) return previous

            // The widths still hold; the tabs have only moved. Mapping them
            // keeps the gaps drawn while the next measurement is taken, rather
            // than collapsing them for a frame on every keystroke.
            const moved: TabWidths = new Map()
            for (const [position, entry] of previous.widths) {
              moved.set(transaction.mapping.map(position), entry)
            }

            return { decorations: buildDecorations(newState.doc, moved), widths: moved }
          },
        },

        props: {
          decorations(state) {
            return tabRenderingKey.getState(state)?.decorations
          },
        },

        view(view) {
          let frame: number | null = null

          /**
           * Measures once the browser has laid the text out.
           *
           * Coalesced into a frame, and the result is only dispatched when it
           * differs from what is already drawn — measuring is triggered by the
           * layout that measuring changes, so anything else is a loop.
           */
          const remeasure = () => {
            if (frame !== null) return

            const run = () => {
              frame = null
              const widths = measure(view)
              const state = tabRenderingKey.getState(view.state)

              if (state === undefined || !differs(state.widths, widths)) return
              view.dispatch(view.state.tr.setMeta(tabRenderingKey, widths))
            }

            if (typeof requestAnimationFrame !== 'function') {
              run()
              return
            }
            frame = requestAnimationFrame(run)
          }

          // Zoom and window size change the layout without a transaction, and a
          // font arriving late changes it without either.
          const observer =
            typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null
          observer?.observe(view.dom)

          remeasure()

          return {
            update: remeasure,
            destroy: () => {
              observer?.disconnect()
              if (frame !== null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(frame)
              }
            },
          }
        },
      }),
    ]
  },
})
