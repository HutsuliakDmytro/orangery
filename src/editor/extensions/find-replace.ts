import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Find & Replace.
 *
 * Matches are decorations, not marks: highlighting a search result must not
 * touch the document, or searching would dirty the file and land in the undo
 * history. The active match gets its own decoration so it can be styled apart
 * from the rest.
 */

export interface FindOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface FindMatch {
  from: number
  to: number
}

export interface FindState {
  options: FindOptions
  matches: FindMatch[]
  activeIndex: number
  decorations: DecorationSet
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
}

export const findPluginKey = new PluginKey<FindState>('findReplace')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setFindOptions: (options: Partial<FindOptions>) => ReturnType
      clearFind: () => ReturnType
      findNext: () => ReturnType
      findPrevious: () => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Returns null when the pattern cannot compile, so a half-typed regex is inert. */
export function buildPattern(options: FindOptions): RegExp | null {
  if (options.query === '') return null

  const source = options.regex ? options.query : escapeRegExp(options.query)
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source
  const flags = options.caseSensitive ? 'gu' : 'giu'

  try {
    return new RegExp(wrapped, flags)
  } catch {
    return null
  }
}

/**
 * Walks text nodes and maps offsets back to document positions. Text is gathered
 * per textblock so a match cannot silently span a paragraph boundary.
 */
export function findMatches(doc: ProseMirrorNode, options: FindOptions): FindMatch[] {
  const pattern = buildPattern(options)
  if (!pattern) return []

  const matches: FindMatch[] = []

  doc.descendants((node, position) => {
    if (!node.isTextblock) return true

    const text = node.textBetween(0, node.content.size, '\n', '￼')
    pattern.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      // A zero-length match (e.g. the regex `a*`) would loop forever.
      if (match[0] === '') {
        pattern.lastIndex += 1
        continue
      }
      const from = position + 1 + match.index
      matches.push({ from, to: from + match[0].length })
    }

    return false
  })

  return matches
}

function buildDecorations(doc: ProseMirrorNode, state: FindState): DecorationSet {
  const decorations = state.matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === state.activeIndex ? 'find-match find-match-active' : 'find-match',
    }),
  )
  return DecorationSet.create(doc, decorations)
}

function recompute(doc: ProseMirrorNode, options: FindOptions, preferredIndex: number): FindState {
  const matches = findMatches(doc, options)
  const activeIndex = matches.length === 0 ? -1 : Math.min(preferredIndex, matches.length - 1)
  const next: FindState = { options, matches, activeIndex, decorations: DecorationSet.empty }
  return { ...next, decorations: buildDecorations(doc, next) }
}

interface FindMeta {
  options?: Partial<FindOptions>
  activeIndex?: number
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findPluginKey,

        state: {
          init: (_config, state: EditorState) => recompute(state.doc, DEFAULT_FIND_OPTIONS, 0),

          apply(tr: Transaction, value: FindState, _old, newState) {
            const meta = tr.getMeta(findPluginKey) as FindMeta | undefined

            if (meta) {
              const options = { ...value.options, ...meta.options }
              return recompute(newState.doc, options, meta.activeIndex ?? value.activeIndex)
            }

            if (!tr.docChanged) return value
            return recompute(newState.doc, value.options, value.activeIndex)
          },
        },

        props: {
          decorations: (state) => findPluginKey.getState(state)?.decorations,
        },
      }),
    ]
  },

  addCommands() {
    return {
      setFindOptions:
        (options: Partial<FindOptions>) =>
        ({ tr, dispatch }) => {
          // Changing the query restarts from the first match.
          dispatch?.(tr.setMeta(findPluginKey, { options, activeIndex: 0 }))
          return true
        },

      clearFind:
        () =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(findPluginKey, { options: DEFAULT_FIND_OPTIONS, activeIndex: 0 }))
          return true
        },

      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const find = findPluginKey.getState(state)
          if (!find || find.matches.length === 0) return false

          const nextIndex = (find.activeIndex + 1) % find.matches.length
          dispatch?.(tr.setMeta(findPluginKey, { activeIndex: nextIndex }))
          return true
        },

      findPrevious:
        () =>
        ({ state, tr, dispatch }) => {
          const find = findPluginKey.getState(state)
          if (!find || find.matches.length === 0) return false

          const previousIndex = (find.activeIndex - 1 + find.matches.length) % find.matches.length
          dispatch?.(tr.setMeta(findPluginKey, { activeIndex: previousIndex }))
          return true
        },

      replaceCurrent:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const find = findPluginKey.getState(state)
          const match = find?.matches[find.activeIndex]
          if (!find || !match) return false

          tr.insertText(replacement, match.from, match.to)
          // Keep the index so the next match slides into place, like Word does.
          dispatch?.(tr.setMeta(findPluginKey, { activeIndex: find.activeIndex }))
          return true
        },

      replaceAll:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const find = findPluginKey.getState(state)
          if (!find || find.matches.length === 0) return false

          // Back to front: replacing shifts every position after the match.
          for (const match of [...find.matches].reverse()) {
            tr.insertText(replacement, match.from, match.to)
          }

          dispatch?.(tr.setMeta(findPluginKey, { activeIndex: 0 }))
          return true
        },
    }
  },
})
